# Writing Risk Analyzer

A privacy-first academic writing-pattern screening tool rvbworks
Drop in a Microsoft Word `.docx` file and receive a conservative document-level risk signal, paragraph explanations, and revision recommendations.

## Privacy

Documents are extracted and analyzed entirely in the browser. The application has no backend, account system, analytics, document storage, or external AI API.

## What the result means

- **At or above the model's validated AI threshold:** AI-pattern match; verify manually.
- **Between the validated thresholds:** Uncertain; the evidence is not decisive.
- **At or below the low-signal threshold:** Low AI-pattern signal; authorship remains unknown.

The score is screening evidence, not proof of authorship. It must not be used alone for an academic-misconduct decision.

## Validation snapshot

The `academic-char-v2` model was trained on prompt-separated ASAP 2.0 human student essays, seven local human calibration documents, and source-matched human/AI pairs from RAID. Thresholds were frozen on an internal validation split before the sealed data was opened.

On 2,380 RAID holdout pairs from unseen sources and generators (GPT-4 and Mistral-Chat), the AI threshold produced 96.55% precision, 75.25% AI recall, and a 2.69% human false-positive rate. On 4,665 human essays from two entirely unseen ASAP prompts, the false-positive rate was 2.57%. None of the four reserved local human documents crossed the AI threshold. These results describe the specified holdouts, not universal accuracy.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the address printed by Vite. Production builds use `npm run build`.

## GitHub Pages

The included workflow builds and deploys every push to `main`. In repository **Settings → Pages**, choose **GitHub Actions** as the source.

Expected project URL: `https://rvbworks.github.io/writing-risk-analyzer/`

## Install on Windows

After the Pages site is live, open it in Edge or Chrome and choose **Install Writing Risk Analyzer** from the browser's Apps menu. The service worker caches the application for offline use after the first successful visit.

## License and attribution

Copyright © 2026 rvbworks. Released under the MIT License. The model was trained with the CC BY 4.0 ASAP 2.0 corpus and the MIT-licensed RAID benchmark. See `training-report-v2.json` for the frozen evaluation protocol and results.8b64d4efaae349572f5c22c4b278f9918d901851
