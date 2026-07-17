# Writing Risk Analyzer

A privacy-first academic writing-pattern screening tool rvbworks
Drop in a Microsoft Word `.docx` file and receive a conservative document-level risk signal, paragraph explanations, and revision recommendations.

## Privacy

Documents are extracted and analyzed entirely in the browser. The application has no backend, account system, analytics, document storage, or external AI API.

## What the result means

- **95–100%:** Strong AI-pattern match; verify manually.
- **26–94%:** Uncertain; the evidence is not decisive.
- **0–25%:** Low AI-pattern signal; authorship remains unknown.

The score is screening evidence, not proof of authorship. It must not be used alone for an academic-misconduct decision.

## Validation snapshot

The compact character-pattern model was trained using corrected labels from HC3 and MAGE. Three complete domains—HC3 `wiki_csai`, MAGE `sci_gen`, and MAGE `yelp`—were excluded from training. At the deliberately strict 95% AI threshold, the 11,672-document held-out evaluation produced 93.31% precision, 0.98% human false positives, and 14.59% AI recall. The low recall is the cost of conservative high-confidence flags.

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

Copyright © 2026 rvbworks. Released under the MIT License. The model was informed by the HC3 and MAGE research datasets; see their respective repositories and papers for dataset terms and research context.
