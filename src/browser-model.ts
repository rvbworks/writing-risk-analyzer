export type BrowserModel = {
  version: string; features: string[]; weights: number[]; intercept: number;
  idf: number[]; thresholds: { human: number; ai: number };
  kind?: "document" | "passage";
  window?: { words: number; stride: number; minimumWords: number };
};

export type PassageWindowScore = {
  startWord: number;
  endWord: number;
  text: string;
  score: number;
  level: "Low signal" | "Review range" | "AI-pattern match";
};

export type PassageScan = {
  modelVersion: string;
  thresholds: { human: number; ai: number };
  totalWords: number;
  sufficientText: boolean;
  coveragePercent: number;
  flaggedWords: number;
  flaggedWindowCount: number;
  reviewWindowCount: number;
  windows: PassageWindowScore[];
};

let cachedDocumentModel: Promise<BrowserModel> | null = null;
let cachedPassageModel: Promise<BrowserModel> | null = null;
const featureIndexes = new WeakMap<BrowserModel, Map<string, number>>();

export function loadBrowserModel() {
  cachedDocumentModel ??= fetch(`${import.meta.env.BASE_URL}model-v1.json`).then(async (response) => {
    if (!response.ok) throw new Error("The scoring file could not load. Refresh the page and try again.");
    return response.json() as Promise<BrowserModel>;
  });
  return cachedDocumentModel;
}

export function loadPassageModel() {
  cachedPassageModel ??= fetch(`${import.meta.env.BASE_URL}passage-model-v1.json`).then(async (response) => {
    if (!response.ok) throw new Error("The section-scoring file could not load. Refresh the page and try again.");
    return response.json() as Promise<BrowserModel>;
  });
  return cachedPassageModel;
}

export function modelProbability(text: string, model: BrowserModel) {
  const normalized = text.toLowerCase().slice(0, 12000);
  let index = featureIndexes.get(model);
  if (!index) {
    index = new Map(model.features.map((feature, i) => [feature, i]));
    featureIndexes.set(model, index);
  }
  const counts = new Map<number, number>();
  for (let size = 3; size <= 5; size++) for (let start = 0; start <= normalized.length - size; start++) {
    const i = index.get(normalized.slice(start, start + size));
    if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const values: Array<[number, number]> = []; let squaredNorm = 0;
  for (const [i, count] of counts) { const value = (1 + Math.log(count)) * model.idf[i]; values.push([i, value]); squaredNorm += value * value; }
  const norm = Math.sqrt(squaredNorm) || 1; let logit = model.intercept;
  for (const [i, value] of values) logit += (value / norm) * model.weights[i];
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))));
}

function passageBounds(wordCount: number, windowWords: number, stride: number) {
  if (wordCount <= windowWords) return [[0, wordCount]] as Array<[number, number]>;
  const starts: number[] = [];
  for (let start = 0; start + windowWords <= wordCount; start += stride) starts.push(start);
  const finalStart = wordCount - windowWords;
  if (starts.at(-1) !== finalStart) starts.push(finalStart);
  return starts.map((start) => [start, start + windowWords] as [number, number]);
}

export function scorePassages(text: string, model: BrowserModel): PassageScan {
  const matches = [...text.matchAll(/[a-z][a-z'-]*/gi)];
  const totalWords = matches.length;
  const config = model.window ?? { words: 180, stride: 90, minimumWords: 80 };

  if (totalWords < config.minimumWords) {
    return {
      modelVersion: model.version,
      thresholds: model.thresholds,
      totalWords,
      sufficientText: false,
      coveragePercent: 0,
      flaggedWords: 0,
      flaggedWindowCount: 0,
      reviewWindowCount: 0,
      windows: [],
    };
  }

  const windows = passageBounds(totalWords, config.words, config.stride).map(([startWord, endWord]) => {
    const startCharacter = matches[startWord].index ?? 0;
    const finalMatch = matches[endWord - 1];
    const endCharacter = (finalMatch.index ?? 0) + finalMatch[0].length;
    const passageText = text.slice(startCharacter, endCharacter);
    const probability = modelProbability(passageText, model);
    const score = Math.round(probability * 100);
    const level: PassageWindowScore["level"] = probability >= model.thresholds.ai
      ? "AI-pattern match"
      : probability <= model.thresholds.human
        ? "Low signal"
        : "Review range";
    return { startWord, endWord, text: passageText, score, level };
  });

  const flaggedBounds = windows
    .filter((window) => window.level === "AI-pattern match")
    .map((window) => [window.startWord, window.endWord] as [number, number])
    .sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const current of flaggedBounds) {
    const previous = merged.at(-1);
    if (!previous || current[0] > previous[1]) merged.push([...current]);
    else previous[1] = Math.max(previous[1], current[1]);
  }
  const flaggedWords = merged.reduce((sum, [start, end]) => sum + end - start, 0);

  return {
    modelVersion: model.version,
    thresholds: model.thresholds,
    totalWords,
    sufficientText: true,
    coveragePercent: Math.round(flaggedWords / Math.max(1, totalWords) * 100),
    flaggedWords,
    flaggedWindowCount: flaggedBounds.length,
    reviewWindowCount: windows.filter((window) => window.level === "Review range").length,
    windows,
  };
}
