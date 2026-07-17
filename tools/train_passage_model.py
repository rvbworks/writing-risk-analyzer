#!/usr/bin/env python3
"""Train the browser passage model with document-separated evaluation.

Documents are assigned to train/validation/holdout partitions before windows are
created.  This prevents overlapping passages from the same source document from
appearing on both sides of an evaluation split.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent

WINDOW_WORDS = 180
STRIDE_WORDS = 90
MINIMUM_WORDS = 80
MAX_TRAIN_WINDOWS_PER_DOCUMENT = 6
MAX_FEATURES = 12_000
TARGET_VALIDATION_DOCUMENT_FPR = 0.01
CANDIDATE_C = [0.5, 1.0, 2.0, 4.0]
WORD_RE = re.compile(r"[a-z][a-z'-]*", re.IGNORECASE)


@dataclass(frozen=True)
class Document:
    text: str
    label: int
    group: str


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raid-dir", type=Path, default=WORK / "raid-matched-v1")
    parser.add_argument("--human-dir", type=Path, default=WORK / "human-corpus-v1")
    parser.add_argument(
        "--asap-csv",
        type=Path,
        default=Path("/tmp/asap2-new/ASAP_2_Final_github_train.csv"),
    )
    parser.add_argument("--output", type=Path, default=ROOT / "public/passage-model-v1.json")
    parser.add_argument(
        "--report",
        type=Path,
        default=ROOT / "training-report-passage-v1.json",
    )
    return parser.parse_args()


def stable_bucket(value: str, modulo=100):
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest(), 16) % modulo


def load_jsonl(path: Path):
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_ids(path: Path):
    with path.open(newline="", encoding="utf-8") as handle:
        return {row["essay_id"] for row in csv.DictReader(handle)}


def load_asap_texts(path: Path, ids: set[str]):
    if not path.exists():
        raise FileNotFoundError(
            f"ASAP 2.0 CSV not found at {path}. Download the official ASAP_2.0 "
            "repository and pass --asap-csv."
        )
    result = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row["essay_id"] in ids:
                result[row["essay_id"]] = row["full_text"]
    missing = ids - set(result)
    if missing:
        raise RuntimeError(f"Missing {len(missing)} requested ASAP essays")
    return result


def word_spans(text: str):
    return [(match.start(), match.end()) for match in WORD_RE.finditer(text)]


def window_bounds(word_count: int):
    if word_count <= WINDOW_WORDS:
        return [(0, word_count)] if word_count >= MINIMUM_WORDS else []

    starts = list(range(0, word_count - WINDOW_WORDS + 1, STRIDE_WORDS))
    final_start = word_count - WINDOW_WORDS
    if not starts or starts[-1] != final_start:
        starts.append(final_start)
    return [(start, start + WINDOW_WORDS) for start in starts]


def document_windows(text: str, maximum: int | None = None):
    spans = word_spans(text)
    bounds = window_bounds(len(spans))
    if maximum and len(bounds) > maximum:
        indices = np.linspace(0, len(bounds) - 1, maximum).round().astype(int)
        bounds = [bounds[index] for index in sorted(set(indices.tolist()))]
    return [text[spans[start][0] : spans[end - 1][1]].lower() for start, end in bounds]


def flatten_windows(documents: list[Document], maximum: int | None = None):
    texts, labels, groups = [], [], []
    skipped = 0
    for document in documents:
        windows = document_windows(document.text, maximum)
        if not windows:
            skipped += 1
            continue
        texts.extend(windows)
        labels.extend([document.label] * len(windows))
        groups.extend([document.group] * len(windows))
    return texts, np.asarray(labels, dtype=np.int8), groups, skipped


def aggregate_max(probabilities, labels, groups):
    aggregate = {}
    for probability, label, group in zip(probabilities, labels, groups):
        previous = aggregate.get(group)
        if previous is None:
            aggregate[group] = [int(label), float(probability)]
        else:
            if previous[0] != int(label):
                raise RuntimeError(f"Mixed labels within document group {group}")
            previous[1] = max(previous[1], float(probability))
    ordered = sorted(aggregate)
    return (
        np.asarray([aggregate[group][0] for group in ordered], dtype=np.int8),
        np.asarray([aggregate[group][1] for group in ordered], dtype=np.float64),
        ordered,
    )


def threshold_at_fpr(human_scores, target_fpr):
    ordered = np.sort(np.asarray(human_scores))
    index = min(len(ordered) - 1, int(np.ceil((1 - target_fpr) * len(ordered))) - 1)
    return float(np.nextafter(ordered[index], 1.0))


def metrics(y, probabilities, threshold):
    predictions = (probabilities >= threshold).astype(np.int8)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y, predictions, average="binary", zero_division=0
    )
    humans = y == 0
    return {
        "documents": int(len(y)),
        "human_documents": int(humans.sum()),
        "ai_documents": int((y == 1).sum()),
        "threshold": float(threshold),
        "precision": float(precision),
        "ai_recall": float(recall),
        "f1": float(f1),
        "human_false_positive_rate": float(predictions[humans].mean()) if humans.any() else None,
        "roc_auc": float(roc_auc_score(y, probabilities)) if len(np.unique(y)) > 1 else None,
    }


def main():
    args = parse_args()
    raid_calibration = load_jsonl(args.raid_dir / "calibration.jsonl")
    raid_holdout = load_jsonl(args.raid_dir / "holdout.jsonl")
    personal_documents = load_jsonl(args.human_dir / "human-corpus-v1.jsonl")
    asap_calibration_ids = load_ids(args.human_dir / "asap2-calibration-ids.csv")
    asap_holdout_ids = load_ids(args.human_dir / "asap2-holdout-ids.csv")
    asap_text = load_asap_texts(
        args.asap_csv, asap_calibration_ids | asap_holdout_ids
    )

    train_documents: list[Document] = []
    validation_documents: list[Document] = []

    # RAID pairs stay together.  The split occurs before passage extraction.
    for row in raid_calibration:
        document = Document(
            text=row["text"],
            label=1 if row["label"] == "ai" else 0,
            group="raid:" + row["id"],
        )
        target = (
            validation_documents
            if stable_bucket("raid-pair:" + row["pair_id"]) < 15
            else train_documents
        )
        target.append(document)

    # ASAP's two reserved prompts remain sealed.  Calibration essays are split
    # by complete essay before any overlapping windows are produced.
    for essay_id in sorted(asap_calibration_ids):
        document = Document(asap_text[essay_id], 0, "asap:" + essay_id)
        target = (
            validation_documents
            if stable_bucket("asap:" + essay_id) < 15
            else train_documents
        )
        target.append(document)

    # Personal writing is evaluation-only so the public model is not calibrated
    # around one author's cadence.
    personal_holdout = [
        Document(row["text"], 0, "personal:" + row["id"])
        for row in personal_documents
    ]

    train_texts, train_y, _, train_skipped = flatten_windows(
        train_documents, MAX_TRAIN_WINDOWS_PER_DOCUMENT
    )
    validation_texts, validation_y, validation_groups, validation_skipped = flatten_windows(
        validation_documents
    )

    vectorizer = TfidfVectorizer(
        analyzer="char",
        ngram_range=(3, 5),
        lowercase=False,
        sublinear_tf=True,
        norm="l2",
        min_df=3,
        max_df=0.995,
        max_features=MAX_FEATURES,
        dtype=np.float32,
    )
    train_matrix = vectorizer.fit_transform(train_texts)
    validation_matrix = vectorizer.transform(validation_texts)

    candidates = []
    selected = None
    for c_value in CANDIDATE_C:
        classifier = LogisticRegression(
            C=c_value,
            class_weight="balanced",
            solver="liblinear",
            max_iter=1000,
            random_state=29,
        )
        classifier.fit(train_matrix, train_y)
        validation_window_scores = classifier.predict_proba(validation_matrix)[:, 1]
        validation_doc_y, validation_doc_scores, _ = aggregate_max(
            validation_window_scores, validation_y, validation_groups
        )
        ai_threshold = threshold_at_fpr(
            validation_doc_scores[validation_doc_y == 0],
            TARGET_VALIDATION_DOCUMENT_FPR,
        )
        result = metrics(validation_doc_y, validation_doc_scores, ai_threshold)
        result.update({"C": c_value, "passage_windows": len(validation_y)})
        candidates.append(result)
        rank = (result["ai_recall"], result["roc_auc"])
        if selected is None or rank > selected[0]:
            selected = (rank, classifier, ai_threshold, validation_doc_y, validation_doc_scores)

    _, classifier, ai_threshold, validation_doc_y, validation_doc_scores = selected
    human_threshold = float(
        np.quantile(validation_doc_scores[validation_doc_y == 1], 0.10)
    )
    human_threshold = min(human_threshold, ai_threshold - 0.01)

    def evaluate(documents):
        texts, labels, groups, skipped = flatten_windows(documents)
        probabilities = classifier.predict_proba(vectorizer.transform(texts))[:, 1]
        document_y, document_scores, ordered_groups = aggregate_max(
            probabilities, labels, groups
        )
        return {
            **metrics(document_y, document_scores, ai_threshold),
            "passage_windows": int(len(labels)),
            "documents_too_short": skipped,
        }, document_scores, ordered_groups

    raid_holdout_documents = [
        Document(
            row["text"],
            1 if row["label"] == "ai" else 0,
            "raid:" + row["id"],
        )
        for row in raid_holdout
    ]
    asap_holdout_documents = [
        Document(asap_text[essay_id], 0, "asap:" + essay_id)
        for essay_id in sorted(asap_holdout_ids)
    ]

    raid_metrics, _, _ = evaluate(raid_holdout_documents)
    asap_metrics, asap_scores, _ = evaluate(asap_holdout_documents)
    personal_metrics, personal_scores, personal_groups = evaluate(personal_holdout)

    report = {
        "version": "academic-passage-char-v1",
        "protocol": {
            "split_before_windowing": True,
            "window_words": WINDOW_WORDS,
            "stride_words": STRIDE_WORDS,
            "minimum_words": MINIMUM_WORDS,
            "maximum_training_windows_per_document": MAX_TRAIN_WINDOWS_PER_DOCUMENT,
            "target_validation_document_fpr": TARGET_VALIDATION_DOCUMENT_FPR,
            "max_features": MAX_FEATURES,
            "character_ngrams": [3, 5],
            "candidate_C": CANDIDATE_C,
            "selected_C": float(classifier.C),
            "thresholds_frozen_before_holdout": {
                "human": human_threshold,
                "ai": ai_threshold,
            },
            "aide_policy": (
                "Excluded after audit: the public CSV has only three AI rows and "
                "substantial near-duplication with ASAP 2.0."
            ),
            "personal_writing_policy": (
                "All local personal documents are evaluation-only and do not fit "
                "features, weights, or thresholds."
            ),
        },
        "counts": {
            "train_documents": dict(
                Counter("ai" if row.label else "human" for row in train_documents)
            ),
            "train_passage_windows": dict(
                Counter("ai" if value else "human" for value in train_y)
            ),
            "validation_documents": dict(
                Counter("ai" if row.label else "human" for row in validation_documents)
            ),
            "validation_passage_windows": dict(
                Counter("ai" if value else "human" for value in validation_y)
            ),
            "documents_too_short": {
                "train": train_skipped,
                "validation": validation_skipped,
            },
        },
        "validation_candidates": candidates,
        "sealed_holdout": {
            "raid_unseen_sources_and_generators": raid_metrics,
            "asap_unseen_prompts_human_only": {
                **asap_metrics,
                "maximum_score_percentiles": [
                    float(value)
                    for value in np.quantile(asap_scores, [0, 0.5, 0.9, 0.95, 0.99, 1])
                ],
            },
            "personal_eleven_documents_human_only": {
                **personal_metrics,
                "maximum_window_scores": [
                    {"id": group, "score": float(score)}
                    for group, score in zip(personal_groups, personal_scores)
                ],
            },
        },
        "limitations": [
            "RAID supplies the source-matched human/AI training pairs but is not an academic-only corpus.",
            "ASAP 2.0 supplies academic human writing; the holdout does not measure academic AI recall.",
            "A flagged window means the passage crossed a learned threshold, not that every word in it was AI-written.",
            "Mixed human/AI passages were not available for this version's training labels.",
        ],
    }

    model = {
        "version": "academic-passage-char-v1",
        "kind": "passage",
        "features": vectorizer.get_feature_names_out().tolist(),
        "weights": [round(float(value), 6) for value in classifier.coef_[0]],
        "intercept": round(float(classifier.intercept_[0]), 6),
        "idf": [round(float(value), 6) for value in vectorizer.idf_],
        "thresholds": {
            "human": round(human_threshold, 6),
            "ai": round(ai_threshold, 6),
        },
        "window": {
            "words": WINDOW_WORDS,
            "stride": STRIDE_WORDS,
            "minimumWords": MINIMUM_WORDS,
        },
        "validation": {
            "protocol": "document split before overlapping passage extraction",
            "report": args.report.name,
        },
    }

    args.output.write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
