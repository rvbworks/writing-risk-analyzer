# Understanding your scores

This guide explains every result shown by Writing Risk Analyzer. You do not need a technical background to use it.

## The most important thing to know

The app shows four separate results. Each one answers a different question.

**Do not add the numbers together or average them.** A high or low number in one area does not change the other areas.

| What you see | The question it answers |
| --- | --- |
| Overall pattern score | How closely does the whole paper match writing patterns the app learned from training examples? |
| Text in flagged sections | How much of the paper is inside smaller sections that reached a strict cutoff? |
| Writing style notes | Does the paper use repeated, uniform, or formula-like writing? |
| Result quality | Is there enough text, and do the style clues agree enough for a useful review? |

These results can point to writing that deserves a closer look. They cannot prove who wrote a paper.

## What happens before scoring

The app opens the Word document in your browser. The file is not uploaded to a server.

It then tries to separate the paper's main writing from items that should not be scored. It skips cover-page details, short headings, web links, citations, and reference lists when it can identify them.

At least 80 body words must remain. If the paper has fewer than 80 body words, the app stops and asks for a longer paper. This rule helps prevent a confident-looking score from a very small sample.

## 1. Overall pattern score

### What it asks

This score asks: **How closely does the whole paper match patterns found more often in the app's AI training examples?**

The app looks at small patterns in letters, words, spacing, and punctuation across the paper. It combines those clues into a score from 0 to 100.

A higher score means a stronger pattern match. It does not mean the app knows who wrote the paper.

### How to read the score

| Score shown | Plain meaning |
| --- | --- |
| 0–54 | Fewer AI-like pattern matches were found. |
| 55–87 | The result is mixed. The app does not have a clear answer. |
| 88–100 | The paper has a strong match to patterns found in the AI training examples. Human review is needed. |

The app uses the exact cutoffs 54.43 and 87.14 before it rounds the score for display.

### What this score does not mean

An overall score of 49 does **not** mean that 49% of the paper was written by AI. It means the whole paper received 49 points on the app's 100-point pattern scale.

The score is also not a grade for writing quality. A clear, well-written human paper can receive a high score. AI-written text can also receive a low score.

## 2. Text in flagged sections

### What it asks

This result asks: **How much of the paper sits inside smaller sections with a very strong pattern match?**

The app checks groups of about 180 words. Each new group starts about 90 words after the last one, so the groups overlap. This overlap helps the app check writing that falls between two sections.

A section is flagged only when it reaches the strict score of 94.30 out of 100.

### How to read the number

- **0%** means no smaller section reached the strict cutoff.
- **25%** means one-quarter of the body words sit inside at least one flagged section.
- **100%** means every body word sits inside one or more flagged sections.

Words in overlapping sections are counted only once.

### Labels used for each section

| Section score | Label shown | What it means |
| --- | --- | --- |
| 67.62 or lower | Fewer pattern matches | The section stayed in the lower range. |
| Above 67.62 but below 94.30 | Needs a closer look | The result is mixed. It is shown for context but does not count as flagged text. |
| 94.30 or higher | Strong match | The section counts toward the flagged-text number and should be reviewed. |

A flagged section does not mean every word in it came from AI. It only marks an area for a person to review.

## 3. Writing style notes

### What they ask

These notes ask: **Does the writing use several style patterns that can make it sound uniform or formula-like?**

The app looks for five main clues:

1. **Similar sentence rhythm:** Many sentences are close to the same length or follow a similar shape.
2. **Stock transitions:** The paper uses common linking phrases such as “furthermore” or “in conclusion” several times.
3. **Repeated openings:** Several sentences begin in the same way.
4. **Limited word variety:** A longer section repeats the same main words instead of using more exact terms.
5. **Repeated wording:** The same short phrases appear more often than expected.

One clue by itself is not treated as proof of AI writing. The style score rises more when several clues appear together.

### Paragraph style labels

| Style score | Label shown |
| --- | --- |
| 0–35 | Few style flags |
| 36–57 | Some style flags |
| 58–100 | Many style flags |

Style notes are editing help. They do not change the overall pattern score or the amount of text in flagged sections.

## 4. Result quality

### What it asks

This check asks: **Does the app have enough writing for a useful result, and do the style clues generally agree?**

The quality label considers:

- how much body text remains after cover and reference material is removed;
- whether the style clues point in similar directions; and
- whether a stronger style concern appears in more than one paragraph.

| Quality score used by the app | Label shown |
| --- | --- |
| 70–100 | Strong result quality |
| 45–69 | Fair result quality |
| 0–44 | Limited result quality |

A stronger quality label is helpful, but it does not guarantee that the other scores are correct. When the main scoring files load normally, this quality check does not raise or lower the overall pattern score.

## Personal writing comparison

Personal writing comparison is currently **off**.

The app does not compare a paper with the user's older papers. It also does not try to decide whether two papers came from the same person. Personal writing samples do not change the public scoring rules.

## Worked example

Suppose a paper reports:

- Overall pattern score: **49/100 — Fewer AI-like writing patterns found**
- Text in flagged sections: **0%**
- Sections flagged: **0 of 4**

This means the whole paper stayed in the lower score range. It also means none of the four smaller sections reached 94.30.

It does **not** mean that 49% of the paper was written by AI.

## How well did the models do in testing?

The project keeps some test papers separate from the training papers. This helps show how the models handle writing they did not study during training.

In one outside test set called RAID:

- When the whole-paper model gave a strong match, 96.55 out of every 100 marked papers were AI-labeled in that test.
- The whole-paper model found 75.25 out of every 100 AI-labeled papers.
- It also gave a strong match to 2.69 out of every 100 human papers.
- When the section model flagged a paper, 97.65 out of every 100 marked papers were AI-labeled in that test.
- The section model found 66.39 out of every 100 AI-labeled papers.
- It flagged 1.60 out of every 100 human papers.

The models were also checked with 4,665 human student essays from writing prompts not used for training:

- The whole-paper model gave a strong match to 2.57 out of every 100 essays.
- The section model flagged at least one section in 2.06 out of every 100 essays.

These numbers apply only to those tests. Results may change with a different subject, age group, language, paper length, editing history, or AI system.

## When to be extra careful

The result may be less useful when a document:

- contains fewer than a few hundred body words;
- is mostly tables, lists, formulas, code, or copied assignment instructions;
- is not written mainly in English;
- mixes writing from several people;
- has been heavily edited by software or another person; or
- uses a type of AI writing that was not represented in training.

## Best way to use the results

- Read flagged sections and check their facts, sources, and wording.
- Keep drafts, notes, and version history when authorship matters.
- Improve a section only when the change makes the writing clearer or more accurate.
- Do not rewrite good work only to lower a detector score.
- Never use this tool, or any AI detector, as the only reason for an accusation or penalty.

## Model names and detailed reports

The current whole-paper model is `academic-char-v2`. The current section model is `academic-passage-char-v1`.

Readers who want the full testing setup and exact data tables can open [`training-report-v2.json`](training-report-v2.json) and [`training-report-passage-v1.json`](training-report-passage-v1.json). The reason the AIDE dataset was not added is recorded in [`aide-audit.json`](aide-audit.json).

