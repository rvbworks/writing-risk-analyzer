export type BrowserModel = {
  version: string; features: string[]; weights: number[]; intercept: number;
  idf: number[]; thresholds: { human: number; ai: number };
};
let cached: Promise<BrowserModel> | null = null;
export function loadBrowserModel() {
  cached ??= fetch(`${import.meta.env.BASE_URL}model-v1.json`).then(async (response) => {
    if (!response.ok) throw new Error("The local analysis model could not be loaded.");
    return response.json() as Promise<BrowserModel>;
  });
  return cached;
}
export function modelProbability(text: string, model: BrowserModel) {
  const normalized = text.toLowerCase().slice(0, 12000);
  const index = new Map(model.features.map((feature, i) => [feature, i]));
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
