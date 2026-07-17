# Writing Risk Analyzer

A privacy-first academic writing-pattern screening tool by rvbworks.
Drop in a Microsoft Word `.docx` file and receive a conservative document classification, learned passage coverage, separate style context, and review recommendations.

## Privacy

Documents are extracted and analyzed entirely in the browser. The application has no backend, account system, analytics, document storage, or external AI API.

## What the result means

- **At or above the model's validated AI threshold:** AI-pattern match; verify manually.
- **Between the validated thresholds:** Uncertain; the evidence is not decisive.
- **At or below the low-signal threshold:** Low AI-pattern signal; authorship remains unknown.

The score is screening evidence, not proof of authorship. It must not be used alone for an academic-misconduct decision.

The document score is a model score out of 100, not the percentage of the paper written by AI. **Flagged passage coverage** is the percentage of unique body words inside overlapping windows that crossed the separately validated passage-model threshold. An optional personal writing profile is planned but is not part of the current result.

## Validation snapshot

The `academic-char-v2` model was trained on prompt-separated ASAP 2.0 human student essays, seven local human calibration documents, and source-matched human/AI pairs from RAID. Thresholds were frozen on an internal validation split before the sealed data was opened.

On 2,380 RAID holdout pairs from unseen sources and generators (GPT-4 and Mistral-Chat), the AI threshold produced 96.55% precision, 75.25% AI recall, and a 2.69% human false-positive rate. On 4,665 human essays from two entirely unseen ASAP prompts, the false-positive rate was 2.57%. None of the four reserved local human documents crossed the AI threshold. These results describe the specified holdouts, not universal accuracy.

The separate `academic-passage-char-v1` model was split by complete source document before overlapping windows were extracted. On the sealed RAID holdout, its document-level passage threshold produced 97.65% precision, 66.39% AI-document recall, and a 1.60% human-document false-positive rate. On the 4,665 ASAP human essays from unseen prompts, 2.06% contained at least one flagged passage. One of eleven local, evaluation-only human documents contained a flagged passage; that small sample is reported for transparency and is not a population estimate. See `training-report-passage-v1.json`.

The public AIDE download was audited but excluded from fitting and independent evaluation. Its CSV contained only three AI-labeled rows, and 1,317 of 1,378 essays had at least 0.90 nearest-text similarity to ASAP 2.0. See `aide-audit.json`. The audit prevents duplicate material from inflating validation results.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the address printed by Vite. Production builds use `npm run build`.

## Reproduce the passage model

The training utilities expect the project-created RAID and human split directories beside this repository and the official ASAP 2.0 training CSV. Documents are split before passage windows are generated.

```bash
python -m pip install -r requirements-training.txt
python tools/audit_aide_dataset.py --aide-csv ../aide-dataset/AIDE_train_essays.csv
python tools/train_passage_model.py --asap-csv /path/to/ASAP_2_Final_github_train.csv
```

The AIDE audit is intentionally a gate: a dataset that fails it is not silently added to training.

## GitHub Pages

The included workflow builds and deploys every push to `main`. In repository **Settings → Pages**, choose **GitHub Actions** as the source.

Expected project URL: `https://rvbworks.github.io/writing-risk-analyzer/`

## Install on Windows

After the Pages site is live, open it in Edge or Chrome and choose **Install Writing Risk Analyzer** from the browser's Apps menu. The service worker caches the application for offline use after the first successful visit.

## License and attribution

Copyright © 2026 rvbworks. Released under the MIT License. The models were trained with the CC BY 4.0 ASAP 2.0 corpus and the MIT-licensed RAID benchmark. AIDE is CC BY 4.0 and was audited but excluded from the model. See the versioned training and audit reports for the frozen protocols and results.
