#!/usr/bin/env python3
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent
RAID = WORK / "raid-matched-v1"
HUMAN = WORK / "human-corpus-v1"
ASAP = Path("/tmp/asap2-new/ASAP_2_Final_github_train.csv")
OUTPUT = ROOT / "public" / "model-v2-candidate.json"
REPORT = ROOT / "training-report-v2.json"

MAX_CHARS = 12000
MAX_FEATURES = 12000
TARGET_VALIDATION_FPR = 0.01
CANDIDATE_C = [0.5, 1.0, 2.0, 4.0]


def stable_bucket(value: str, modulo=100):
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest(), 16) % modulo


def normalize(text: str):
    return text.lower()[:MAX_CHARS]


def load_jsonl(path):
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_ids(path):
    with path.open(newline="", encoding="utf-8") as handle:
        return {row["essay_id"] for row in csv.DictReader(handle)}


def load_asap_texts(ids):
    result = {}
    with ASAP.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row["essay_id"] in ids:
                result[row["essay_id"]] = row["full_text"]
    missing = ids - set(result)
    if missing:
        raise RuntimeError(f"Missing {len(missing)} ASAP essays")
    return result


def add(rows, texts, labels, groups, split_name):
    for text, label, group in rows:
        texts.append(normalize(text))
        labels.append(label)
        groups.append(split_name + ":" + group)


raid_cal = load_jsonl(RAID / "calibration.jsonl")
raid_holdout = load_jsonl(RAID / "holdout.jsonl")
personal_cal = load_jsonl(HUMAN / "calibration.jsonl")
personal_holdout = load_jsonl(HUMAN / "holdout.jsonl")
asap_cal_ids = load_ids(HUMAN / "asap2-calibration-ids.csv")
asap_hold_ids = load_ids(HUMAN / "asap2-holdout-ids.csv")
asap_text = load_asap_texts(asap_cal_ids | asap_hold_ids)

train_rows = []
validation_rows = []

# RAID pairs stay together when calibration is subdivided.
for row in raid_cal:
    target = validation_rows if stable_bucket("raid:" + row["pair_id"]) < 15 else train_rows
    target.append((row["text"], 1 if row["label"] == "ai" else 0, "raid:" + row["pair_id"]))

# ASAP calibration essays are verified-human negatives.
for essay_id in sorted(asap_cal_ids):
    target = validation_rows if stable_bucket("asap:" + essay_id) < 15 else train_rows
    target.append((asap_text[essay_id], 0, "asap:" + essay_id))

# The seven personal calibration documents deliberately strengthen the local
# human baseline. The four personal holdouts remain unopened by fitting code.
for row in personal_cal:
    train_rows.append((row["text"], 0, "personal:" + row["id"]))

train_texts, train_y, train_groups = [], [], []
val_texts, val_y, val_groups = [], [], []
add(train_rows, train_texts, train_y, train_groups, "train")
add(validation_rows, val_texts, val_y, val_groups, "validation")
train_y = np.asarray(train_y, dtype=np.int8)
val_y = np.asarray(val_y, dtype=np.int8)

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
X_train = vectorizer.fit_transform(train_texts)
X_val = vectorizer.transform(val_texts)


def ai_threshold_at_fpr(human_probabilities, target_fpr):
    # Smallest threshold whose empirical human false-positive rate is at most target.
    ordered = np.sort(np.asarray(human_probabilities))
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
        "human_false_positive_rate": float(predictions[humans].mean()),
        "roc_auc": float(roc_auc_score(y, probabilities)) if len(np.unique(y)) > 1 else None,
    }


candidates = []
best = None
for c in CANDIDATE_C:
    classifier = LogisticRegression(
        C=c,
        class_weight="balanced",
        solver="liblinear",
        max_iter=1000,
        random_state=17,
    )
    classifier.fit(X_train, train_y)
    probabilities = classifier.predict_proba(X_val)[:, 1]
    threshold = ai_threshold_at_fpr(probabilities[val_y == 0], TARGET_VALIDATION_FPR)
    result = metrics(val_y, probabilities, threshold)
    result["C"] = c
    candidates.append(result)
    if best is None or (result["ai_recall"], result["roc_auc"]) > (best[0]["ai_recall"], best[0]["roc_auc"]):
        best = (result, classifier)

selected, classifier = best
ai_threshold = selected["threshold"]

# A low-signal boundary is calibrated from AI validation probabilities: only
# the lowest 10% of known AI may fall beneath it on the calibration validation set.
val_probabilities = classifier.predict_proba(X_val)[:, 1]
human_threshold = float(np.quantile(val_probabilities[val_y == 1], 0.10))
human_threshold = min(human_threshold, ai_threshold - 0.01)

# Sealed evaluation: opened only after C and thresholds are fixed above.
holdout_rows = []
for row in raid_holdout:
    holdout_rows.append((row["text"], 1 if row["label"] == "ai" else 0, "raid:" + row["pair_id"]))
for essay_id in sorted(asap_hold_ids):
    holdout_rows.append((asap_text[essay_id], 0, "asap:" + essay_id))
for row in personal_holdout:
    holdout_rows.append((row["text"], 0, "personal:" + row["id"]))

hold_texts = [normalize(row[0]) for row in holdout_rows]
hold_y = np.asarray([row[1] for row in holdout_rows], dtype=np.int8)
hold_groups = [row[2] for row in holdout_rows]
hold_prob = classifier.predict_proba(vectorizer.transform(hold_texts))[:, 1]

raid_mask = np.asarray([group.startswith("raid:") for group in hold_groups])
asap_mask = np.asarray([group.startswith("asap:") for group in hold_groups])
personal_mask = np.asarray([group.startswith("personal:") for group in hold_groups])

report = {
    "version": "academic-char-v2-candidate",
    "protocol": {
        "target_validation_human_fpr": TARGET_VALIDATION_FPR,
        "max_features": MAX_FEATURES,
        "character_ngrams": [3, 5],
        "candidate_C": CANDIDATE_C,
        "selected_C": selected["C"],
        "thresholds_frozen_before_holdout": {"human": human_threshold, "ai": ai_threshold},
    },
    "counts": {
        "train": dict(Counter("ai" if y else "human" for y in train_y)),
        "validation": dict(Counter("ai" if y else "human" for y in val_y)),
    },
    "validation_candidates": candidates,
    "sealed_holdout": {
        "overall": metrics(hold_y, hold_prob, ai_threshold),
        "raid_unseen_models": metrics(hold_y[raid_mask], hold_prob[raid_mask], ai_threshold),
        "asap_unseen_prompts": {
            **metrics(hold_y[asap_mask], hold_prob[asap_mask], ai_threshold),
            "probability_percentiles": [float(x) for x in np.quantile(hold_prob[asap_mask], [0, .5, .9, .95, .99, 1])],
        },
        "personal_four_documents": {
            **metrics(hold_y[personal_mask], hold_prob[personal_mask], ai_threshold),
            "probabilities": [
                {"id": group, "ai_probability": float(prob)}
                for group, prob in zip(np.asarray(hold_groups)[personal_mask], hold_prob[personal_mask])
            ],
        },
    },
}

features = vectorizer.get_feature_names_out().tolist()
model = {
    "version": "academic-char-v2",
    "features": features,
    "weights": [round(float(x), 6) for x in classifier.coef_[0]],
    "intercept": round(float(classifier.intercept_[0]), 6),
    "idf": [round(float(x), 6) for x in vectorizer.idf_],
    "thresholds": {"human": round(human_threshold, 6), "ai": round(ai_threshold, 6)},
    "validation": {
        "protocol": "ASAP prompt-disjoint human holdout plus RAID source/model-disjoint holdout",
        "report": "training-report-v2.json",
    },
}

OUTPUT.write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
