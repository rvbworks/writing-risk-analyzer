import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";

const model = JSON.parse(fs.readFileSync(new URL("../public/model-v1.json", import.meta.url), "utf8"));
const uploadDir = new URL("../../upload/", import.meta.url);
const files = [
  "Robert VanBuren - Mod 3 Journal(2).docx",
  "Robert VanBuren - Two Languages, Two Worlds, One Lesson.docx",
  "PHY 150 Project Three - VanBuren.docx",
  "MAT 350 Project One Table VanBuren.docx",
];

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

function probability(text) {
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

for (const filename of files) {
  const filePath = path.join(uploadDir.pathname, filename);
  const raw = (await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) })).value;
  const clean = modelInputText(raw);
  const score = probability(clean);
  console.log(JSON.stringify({ filename, body_words: words(clean).length, ai_probability: score, classification: score >= model.thresholds.ai ? "ai" : score <= model.thresholds.human ? "low" : "uncertain" }));
}
