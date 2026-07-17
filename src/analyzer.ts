export type Signal = {
  key: "model" | "predictability" | "patterns" | "guard";
  label: string;
  score: number;
  detail: string;
};

export type ParagraphResult = {
  text: string;
  score: number;
  level: "Low" | "Moderate" | "Elevated";
  reasons: string[];
};

export type Analysis = {
  score: number;
  confidence: "Low" | "Moderate" | "High";
  verdict: string;
  wordCount: number;
  excludedWordCount: number;
  signals: Signal[];
  paragraphs: ParagraphResult[];
  recommendations: string[];
  modelProbability?: number;
  modelVersion?: string;
  thresholds?: { human: number; ai: number };
};

const AI_TRANSITIONS = [
  "additionally", "furthermore", "moreover", "in conclusion", "in summary",
  "it is important to note", "it is worth noting", "ultimately",
  "this highlights", "this underscores", "in today's", "in the realm of",
];

const TEMPLATE_PHRASES = [
  "plays a crucial role", "plays a vital role", "a wide range of", "delve into",
  "multifaceted", "ever-evolving", "seamlessly", "comprehensive understanding",
  "cannot be overstated", "serves as a testament", "pave the way", "key takeaway",
];

const STOPWORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her hers him his i if in into is it its may might more most my no not of on one or our ours she should so than that the their theirs them they this those to too us was we were what when which who will with would you your yours".split(" "),
);

export function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function sentences(text: string) {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

export function words(text: string) {
  return text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
}

function coefficientOfVariation(values: number[]) {
  if (values.length < 2) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return mean ? Math.sqrt(variance) / mean : 1;
}

function repeatedNgramRate(tokens: string[], size: number) {
  if (tokens.length < size * 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i <= tokens.length - size; i++) {
    const gram = tokens.slice(i, i + size).join(" ");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  const repeated = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return repeated / Math.max(1, counts.size);
}

function isReferenceHeading(block: string) {
  return /^(references|works cited|bibliography)\s*[:.]?$/i.test(block.trim());
}

function looksLikeReference(block: string) {
  const lower = block.toLowerCase();
  return /\bhttps?:\/\//.test(block) || /\bdoi\b/.test(lower) ||
    (/\(20\d{2}[a-z]?\)\./.test(block) && /\b(volume|vol\.|transactions|journal|information|software|article)\b/i.test(block));
}

function proseBlocks(raw: string) {
  const normalized = raw.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  const allBlocks = normalized.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const kept: string[] = [];
  const excluded: string[] = [];
  let inReferences = false;
  let bodyStarted = false;

  for (const block of allBlocks) {
    if (isReferenceHeading(block)) {
      inReferences = true;
      excluded.push(block);
      continue;
    }
    const count = words(block).length;
    if (inReferences || looksLikeReference(block)) {
      excluded.push(block);
      continue;
    }
    // Cover pages, running titles, headings, names, and course metadata are not prose.
    if (!bodyStarted && (count < 35 || sentences(block).length < 2)) {
      excluded.push(block);
      continue;
    }
    if (count >= 35 && sentences(block).length >= 2) bodyStarted = true;
    if (bodyStarted && count >= 20 && sentences(block).length >= 2) kept.push(block);
    else excluded.push(block);
  }
  return { kept, excluded, normalized };
}

export function modelInputText(raw: string) {
  const { kept, normalized } = proseBlocks(raw);
  return (kept.length ? kept : [normalized]).join("\n\n");
}

export function analyzeParagraph(text: string): ParagraphResult {
  const s = sentences(text);
  const w = words(text);
  const lower = text.toLowerCase();
  const lengths = s.map((item) => words(item).length).filter(Boolean);
  const cv = coefficientOfVariation(lengths);
  const transitionHits = AI_TRANSITIONS.filter((phrase) => lower.includes(phrase)).length;
  const templateHits = TEMPLATE_PHRASES.filter((phrase) => lower.includes(phrase)).length;
  const starts = s.map((item) => words(item).slice(0, 3).join(" ")).filter(Boolean);
  const duplicateStarts = starts.length - new Set(starts).size;
  const contentWords = w.filter((word) => !STOPWORDS.has(word));
  const lexicalDiversity = contentWords.length ? new Set(contentWords).size / contentWords.length : 1;
  const repetition = repeatedNgramRate(w, 3);

  const uniformSignal = cv < 0.31 && s.length >= 5;
  const transitionSignal = transitionHits >= 2 || (transitionHits === 1 && s.length <= 4);
  const templateSignal = templateHits > 0;
  const startSignal = duplicateStarts >= 2;
  const lexicalSignal = lexicalDiversity < 0.43 && contentWords.length >= 70;
  const repetitionSignal = repetition > 0.105;
  const activeSignals = [uniformSignal, transitionSignal, templateSignal, startSignal, lexicalSignal, repetitionSignal].filter(Boolean).length;

  // No single style feature is sufficient. Scores rise meaningfully only when
  // independent features corroborate each other.
  let score = 7;
  if (uniformSignal) score += 10;
  if (transitionSignal) score += Math.min(10, transitionHits * 4);
  if (templateSignal) score += Math.min(14, templateHits * 7);
  if (startSignal) score += Math.min(8, duplicateStarts * 3);
  if (lexicalSignal) score += 8;
  if (repetitionSignal) score += Math.min(12, repetition * 55);
  if (activeSignals >= 2) score += 8;
  if (activeSignals >= 3) score += 10;
  // Short passages deserve lower confidence, but strong corroborated signals
  // should not disappear merely because a paragraph is concise.
  if (w.length < 80 && activeSignals < 2) score *= 0.72;
  if (s.length < 4 && activeSignals < 2) score *= 0.7;

  const reasons: string[] = [];
  if (uniformSignal) reasons.push("Sentence lengths show unusually low variation.");
  if (transitionSignal) reasons.push(`${transitionHits} formulaic transition${transitionHits === 1 ? "" : "s"} detected.`);
  if (templateSignal) reasons.push(`${templateHits} common template phrase${templateHits === 1 ? "" : "s"} detected.`);
  if (startSignal) reasons.push("Several sentences begin with the same structure.");
  if (lexicalSignal) reasons.push("Content-word variety is low for the passage length.");
  if (repetitionSignal) reasons.push("Repeated phrasing lowers structural variety.");
  if (!reasons.length) reasons.push("No corroborated mechanical-writing pattern was found.");

  const finalScore = Math.round(clamp(score));
  return {
    text,
    score: finalScore,
    level: finalScore >= 58 ? "Elevated" : finalScore >= 36 ? "Moderate" : "Low",
    reasons,
  };
}

export function analyzeDocument(
  raw: string,
  learnedProbability?: number,
  modelVersion?: string,
  thresholds: { human: number; ai: number } = { human: 0.25, ai: 0.95 },
): Analysis {
  const { kept, excluded, normalized } = proseBlocks(raw);
  const sourceParagraphs = kept.length ? kept : [normalized];
  const paragraphs = sourceParagraphs.map(analyzeParagraph);
  const clean = sourceParagraphs.join("\n\n");
  const allWords = words(clean);
  const allSentences = sentences(clean);
  const weightedRisk = paragraphs.reduce((sum, p) => sum + p.score * words(p.text).length, 0) / Math.max(1, allWords.length);
  const sentenceLengths = allSentences.map((s) => words(s).length).filter(Boolean);
  const globalCv = coefficientOfVariation(sentenceLengths);
  const globalRepetition = repeatedNgramRate(allWords, 3);
  const predictability = Math.round(clamp(10 + Math.max(0, 0.34 - globalCv) * 55 + Math.max(0, globalRepetition - 0.07) * 80));
  const templateCount = [...AI_TRANSITIONS, ...TEMPLATE_PHRASES].filter((phrase) => clean.toLowerCase().includes(phrase)).length;
  const patterns = Math.round(clamp(weightedRisk * 0.78 + Math.max(0, templateCount - 1) * 3));
  const shortPenalty = allWords.length < 150 ? 32 : allWords.length < 300 ? 16 : 0;
  const disagreement = Math.abs(predictability - patterns);
  const strongestParagraph = Math.max(...paragraphs.map((p) => p.score));
  const corroborationCredit = strongestParagraph >= 58 && paragraphs.length >= 2 ? 18 : 0;
  const guardStrength = Math.round(clamp(92 - shortPenalty - Math.min(25, disagreement * 0.4) + corroborationCredit));
  const heuristicSignal = Math.round(clamp(weightedRisk * 0.7 + predictability * 0.15 + patterns * 0.15));
  const learnedSignal = learnedProbability === undefined ? undefined : Math.round(clamp(learnedProbability * 100));
  const modelSignal = learnedSignal ?? heuristicSignal;
  const corroboration = Math.min(100, heuristicSignal * 1.35);
  // With a learned model available, display its probability-like score.
  // Heuristics remain explanatory and do not silently alter that percentage.
  const guardedScore = learnedSignal === undefined ? Math.round(clamp(modelSignal * (0.58 + guardStrength / 400))) : modelSignal;

  const confidence: Analysis["confidence"] =
    allWords.length >= 500 && disagreement < 16 ? "High" :
    allWords.length >= 220 && disagreement < 26 ? "Moderate" :
    patterns >= 55 && paragraphs.length >= 2 ? "Moderate" : "Low";

  const verdict = learnedSignal === undefined ? "Pattern analysis only — model unavailable"
    : learnedProbability! >= thresholds.ai ? "AI-pattern match — verify manually"
    : learnedProbability! <= thresholds.human ? "Low AI-pattern signal — authorship remains unknown"
    : "Uncertain — evidence is not decisive";

  const recommendations: string[] = [];
  if (templateCount >= 2) recommendations.push("Review stock transitions or template phrases where they do not add meaning.");
  if (paragraphs.some((p) => p.reasons.some((r) => r.includes("low variation")))) recommendations.push("Review sentence rhythm only in the specifically highlighted passages; uniformity alone is not evidence of AI authorship.");
  if (paragraphs.some((p) => p.reasons.some((r) => r.includes("Repeated")))) recommendations.push("Remove repeated wording when it makes the argument less precise.");
  if (paragraphs.some((p) => p.score >= 36)) recommendations.push("Add concrete examples, course-specific details, or properly cited evidence where they strengthen the highlighted passage.");
  if (!recommendations.length) recommendations.push("No pattern-based revision is warranted. Edit only for clarity, accuracy, and assignment requirements.");
  recommendations.push("Treat this result as a screening signal, not proof of authorship; preserve drafts and revision history when authorship matters.");

  return {
    score: guardedScore,
    confidence,
    verdict,
    wordCount: allWords.length,
    excludedWordCount: excluded.reduce((sum, block) => sum + words(block).length, 0),
    signals: [
      { key: "model", label: learnedSignal === undefined ? "Pattern fallback" : "Learned model", score: modelSignal, detail: learnedSignal === undefined ? "Model unavailable; style signals only" : "Character-pattern classifier" },
      { key: "predictability", label: "Predictability", score: predictability, detail: "Rhythm, repetition, and variation" },
      { key: "patterns", label: "Writing patterns", score: patterns, detail: "Structure and template language" },
      { key: "guard", label: "False-positive guard", score: guardStrength, detail: "Evidence quality and text length" },
    ],
    paragraphs,
    recommendations: [...new Set(recommendations)],
    modelProbability: learnedProbability,
    modelVersion,
    thresholds,
  };
}

export function scoreTone(score: number, guard = false) {
  if (guard) return score >= 70 ? "safe" : score >= 45 ? "watch" : "risk";
  return score >= 62 ? "risk" : score >= 36 ? "watch" : "safe";
}
