import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";

const documentModel = JSON.parse(fs.readFileSync(new URL("../public/model-v1.json", import.meta.url), "utf8"));
const passageModel = JSON.parse(fs.readFileSync(new URL("../public/passage-model-v1.json", import.meta.url), "utf8"));
const uploadDir = new URL("../../upload/", import.meta.url);
const files = fs.readdirSync(uploadDir).filter(filename => filename.toLowerCase().endsWith(".docx")).sort();

const words = text => text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
const sentences = text => text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [];
const isReferenceHeading = block => /^(references|works cited|bibliography)\s*[:.]?$/i.test(block.trim());
const looksLikeReference = block => /\bhttps?:\/\//.test(block) || /\bdoi\b/i.test(block) ||
  (/\(20\d{2}[a-z]?\)\./.test(block) && /\b(volume|vol\.|transactions|journal|information|software|article)\b/i.test(block));

function modelInputText(raw) {
  const normalized = raw.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  const allBlocks = normalized.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const kept = [];
  let inReferences = false;
  let bodyStarted = false;
  for (const block of allBlocks) {
    if (isReferenceHeading(block)) { inReferences = true; continue; }
    const count = words(block).length;
    if (inReferences || looksLikeReference(block)) continue;
    if (!bodyStarted && (count < 35 || sentences(block).length < 2)) continue;
    if (count >= 35 && sentences(block).length >= 2) bodyStarted = true;
    if (bodyStarted && count >= 20 && sentences(block).length >= 2) kept.push(block);
  }
  return (kept.length ? kept : [normalized]).join("\n\n");
}

function probability(text, model) {
  const normalized = text.toLowerCase().slice(0, 12000);
  const index = new Map(model.features.map((feature, i) => [feature, i]));
  const counts = new Map();
  for (let size = 3; size <= 5; size++) for (let start = 0; start <= normalized.length - size; start++) {
    const i = index.get(normalized.slice(start, start + size));
    if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const values = []; let squaredNorm = 0;
  for (const [i, count] of counts) {
    const value = (1 + Math.log(count)) * model.idf[i];
    values.push([i, value]); squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm) || 1;
  let logit = model.intercept;
  for (const [i, value] of values) logit += value / norm * model.weights[i];
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))));
}

function passageBounds(wordCount, windowWords, stride) {
  if (wordCount <= windowWords) return [[0, wordCount]];
  const starts = [];
  for (let start = 0; start + windowWords <= wordCount; start += stride) starts.push(start);
  const finalStart = wordCount - windowWords;
  if (starts.at(-1) !== finalStart) starts.push(finalStart);
  return starts.map(start => [start, start + windowWords]);
}

function passageResult(text) {
  const matches = [...text.matchAll(/[a-z][a-z'-]*/gi)];
  const config = passageModel.window;
  if (matches.length < config.minimumWords) return { coverage: null, flagged: 0, windows: 0, maximum: null };
  const results = passageBounds(matches.length, config.words, config.stride).map(([start, end]) => {
    const begin = matches[start].index;
    const final = matches[end - 1];
    const finish = final.index + final[0].length;
    return { start, end, score: probability(text.slice(begin, finish), passageModel) };
  });
  const intervals = results.filter(result => result.score >= passageModel.thresholds.ai).map(result => [result.start, result.end]);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) merged.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  const flaggedWords = merged.reduce((sum, [start, end]) => sum + end - start, 0);
  return {
    coverage: Math.round(flaggedWords / matches.length * 100),
    flagged: intervals.length,
    windows: results.length,
    maximum: Math.max(...results.map(result => result.score)),
  };
}

for (const filename of files) {
  const filePath = path.join(uploadDir.pathname, filename);
  const raw = (await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) })).value;
  const clean = modelInputText(raw);
  const bodyWords = words(clean).length;
  if (bodyWords < 80) {
    console.log(JSON.stringify({
      filename,
      body_words: bodyWords,
      document_score: null,
      document_classification: "insufficient body text",
      passage_coverage_percent: null,
      passage_windows_flagged: 0,
      passage_windows_total: 0,
      maximum_passage_score: null,
    }));
    continue;
  }
  const score = probability(clean, documentModel);
  const passages = passageResult(clean);
  console.log(JSON.stringify({
    filename,
    body_words: bodyWords,
    document_score: score,
    document_classification: score >= documentModel.thresholds.ai ? "ai-pattern match" : score <= documentModel.thresholds.human ? "low signal" : "uncertain",
    passage_coverage_percent: passages.coverage,
    passage_windows_flagged: passages.flagged,
    passage_windows_total: passages.windows,
    maximum_passage_score: passages.maximum,
  }));
}
