#!/usr/bin/env python3
import csv
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent
model = json.loads((ROOT / "public/model-v1.json").read_text())


def probability(text):
    normalized = text.lower()[:12000]
    index = {feature: i for i, feature in enumerate(model["features"])}
    counts = {}
    for size in range(3, 6):
        for start in range(len(normalized) - size + 1):
            i = index.get(normalized[start:start + size])
            if i is not None:
                counts[i] = counts.get(i, 0) + 1
    values = []
    squared_norm = 0.0
    for i, count in counts.items():
        value = (1 + math.log(count)) * model["idf"][i]
        values.append((i, value))
        squared_norm += value * value
    norm = math.sqrt(squared_norm) or 1
    logit = model["intercept"] + sum(value / norm * model["weights"][i] for i, value in values)
    logit = max(-30, min(30, logit))
    return 1 / (1 + math.exp(-logit))


raid = [json.loads(x) for x in (WORK / "raid-matched-v1/holdout.jsonl").open()]
personal = [json.loads(x) for x in (WORK / "human-corpus-v1/holdout.jsonl").open()]
with (WORK / "human-corpus-v1/asap2-holdout-ids.csv").open(newline="") as f:
    asap_ids = {row["essay_id"] for row in csv.DictReader(f)}
asap = []
with Path("/tmp/asap2-new/ASAP_2_Final_github_train.csv").open(newline="", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        if row["essay_id"] in asap_ids:
            asap.append(row["full_text"])

threshold = model["thresholds"]["ai"]
raid_prob = np.asarray([probability(x["text"]) for x in raid])
raid_y = np.asarray([x["label"] == "ai" for x in raid])
asap_prob = np.asarray([probability(x) for x in asap])
personal_prob = np.asarray([probability(x["text"]) for x in personal])

result = {
    "version": model["version"],
    "threshold": threshold,
    "raid_unseen_models": {
        "human_false_positive_rate": float((raid_prob[~raid_y] >= threshold).mean()),
        "ai_recall": float((raid_prob[raid_y] >= threshold).mean()),
    },
    "asap_unseen_prompts": {
        "human_false_positive_rate": float((asap_prob >= threshold).mean()),
    },
    "personal_four_documents": {
        "human_false_positive_rate": float((personal_prob >= threshold).mean()),
        "probabilities": [float(x) for x in personal_prob],
    },
}
print(json.dumps(result, indent=2))
