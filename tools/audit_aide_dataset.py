#!/usr/bin/env python3
"""Audit the public AIDE CSV before it can be admitted to model training."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--aide-csv", type=Path, default=WORK / "aide-dataset/AIDE_train_essays.csv"
    )
    parser.add_argument(
        "--asap-csv",
        type=Path,
        default=Path("/tmp/asap2-new/ASAP_2_Final_github_train.csv"),
    )
    parser.add_argument("--output", type=Path, default=ROOT / "aide-audit.json")
    return parser.parse_args()


def normalized_hash(text):
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def main():
    args = parse_args()
    with args.aide_csv.open(newline="", encoding="utf-8-sig") as handle:
        aide = list(csv.DictReader(handle))
    with args.asap_csv.open(newline="", encoding="utf-8-sig") as handle:
        asap = list(csv.DictReader(handle))

    expected_columns = {"id", "prompt_id", "text", "generated"}
    actual_columns = set(aide[0]) if aide else set()
    if actual_columns != expected_columns:
        raise RuntimeError(
            f"Unexpected AIDE columns: {sorted(actual_columns)}; expected {sorted(expected_columns)}"
        )

    asap_hashes = {normalized_hash(row["full_text"]) for row in asap}
    exact_overlap = sum(normalized_hash(row["text"]) in asap_hashes for row in aide)

    # Word unigram/bigram similarity catches formatting and cleaning variants of
    # the same essay that exact hashes miss.
    vectorizer = TfidfVectorizer(
        lowercase=True, ngram_range=(1, 2), min_df=2, max_features=60_000, sublinear_tf=True
    )
    matrix = vectorizer.fit_transform(
        [row["full_text"] for row in asap] + [row["text"] for row in aide]
    )
    neighbors = NearestNeighbors(n_neighbors=1, metric="cosine", algorithm="brute")
    neighbors.fit(matrix[: len(asap)])
    distances, _ = neighbors.kneighbors(matrix[len(asap) :])
    similarities = 1 - distances[:, 0]

    labels = Counter(row["generated"] for row in aide)
    prompt_labels = Counter((row["prompt_id"], row["generated"]) for row in aide)
    report = {
        "dataset": "AIDE public Kaggle download",
        "license": "CC BY 4.0",
        "rows": len(aide),
        "columns": sorted(actual_columns),
        "labels": {"human": labels.get("0", 0), "ai": labels.get("1", 0)},
        "prompt_label_counts": [
            {"prompt_id": prompt, "label": "ai" if label == "1" else "human", "rows": count}
            for (prompt, label), count in sorted(prompt_labels.items())
        ],
        "overlap_with_asap_2": {
            "exact_normalized_text": exact_overlap,
            "nearest_similarity_at_least_0_90": int((similarities >= 0.90).sum()),
            "nearest_similarity_at_least_0_95": int((similarities >= 0.95).sum()),
            "nearest_similarity_percentiles": {
                str(percentile): float(value)
                for percentile, value in zip(
                    [0, 25, 50, 75, 90, 95, 99, 100],
                    np.quantile(similarities, [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1]),
                )
            },
        },
        "decision": "excluded_from_training_and_independent_evaluation",
        "reasons": [
            "The downloaded CSV contains only three AI-labeled essays, which is inadequate for AI-model training or recall estimation.",
            "Most human essays are near-duplicates of ASAP 2.0 material already used by the project, so treating them as independent evidence would leak sources.",
            "The accompanying instructions describe generating and filtering a larger synthetic set, but those generated essays are not present in the public CSV.",
        ],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
