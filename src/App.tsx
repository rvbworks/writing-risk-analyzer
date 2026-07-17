import type { ChangeEvent, CSSProperties, DragEvent } from "react";
import { useMemo, useRef, useState } from "react";
import mammoth from "mammoth/mammoth.browser";
import { Analysis, Signal, analyzeDocument, classificationTone, modelInputText, scoreTone, words } from "./analyzer";
import { loadBrowserModel, loadPassageModel, modelProbability, scorePassages } from "./browser-model";

function moduleTone(signal: Signal, analysis: Analysis) {
  if (signal.key === "model") return classificationTone((analysis.modelProbability ?? signal.score / 100) * 100, analysis.thresholds ?? { human: 0.25, ai: 0.95 });
  if (signal.key === "passage") return signal.score === 0 ? "safe" : signal.score < 25 ? "watch" : "risk";
  return scoreTone(signal.score, signal.key === "guard");
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const fileLabel = useMemo(() => file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "No file selected", [file]);
  const displayedPassages = useMemo(() => {
    const windows = analysis?.passageScan?.windows ?? [];
    const matches = windows.filter((window) => window.level === "AI-pattern match");
    const review = windows.filter((window) => window.level === "Review range").sort((left, right) => right.score - left.score);
    if (matches.length) return [...matches, ...review.slice(0, Math.max(0, 12 - matches.length))].sort((left, right) => left.startWord - right.startWord);
    if (review.length) return review.slice(0, 12).sort((left, right) => left.startWord - right.startWord);
    return [...windows].sort((left, right) => right.score - left.score).slice(0, 3).sort((left, right) => left.startWord - right.startWord);
  }, [analysis]);

  function acceptFile(candidate?: File) {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".docx")) {
      setError("Choose a Microsoft Word .docx file.");
      return;
    }
    if (candidate.size > 10 * 1024 * 1024) {
      setError("The document must be smaller than 10 MB.");
      return;
    }
    setFile(candidate);
    setError("");
    setAnalysis(null);
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  async function runAnalysis() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      const analysisText = modelInputText(result.value);
      if (words(analysisText).length < 80) throw new Error("After headings, front matter, and references are excluded, at least 80 body words are required for a validated scan.");
      const [model, passageModel] = await Promise.all([loadBrowserModel(), loadPassageModel()]);
      const passageScan = scorePassages(analysisText, passageModel);
      setAnalysis(analyzeDocument(result.value, modelProbability(analysisText, model), model.version, model.thresholds, passageScan));
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The document could not be read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Private writing review</p>
          <h1>Writing Risk Analyzer</h1>
        </div>
        <div className="privacy-badge" title="Your document is processed on this device and is not uploaded.">
          <span aria-hidden="true">✓</span> Runs locally in your browser
        </div>
      </header>

      <section className="hero-grid" aria-label="Document analysis">
        <div className="upload-card">
          <div
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            role="button"
            tabIndex={0}
            aria-label="Choose or drop a Word document"
          >
            <div className="doc-icon" aria-hidden="true"><b>W</b></div>
            <h2>Drop your Word document here</h2>
            <p>DOCX only · Maximum 10 MB</p>
            <button type="button" className="browse-button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Browse files</button>
            <input ref={inputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onInput} hidden />
          </div>
          <button className="analyze-button" type="button" disabled={!file || busy} onClick={runAnalysis}>
            {busy ? "Analyzing locally…" : "Analyze document"}
          </button>
          <p className="file-status" aria-live="polite">{fileLabel}</p>
          {error && <p className="error" role="alert">{error}</p>}
        </div>

        <aside className="preview-card">
          <div className="section-heading">
            <div><p className="eyebrow">Evidence, not a verdict</p><h2>Analysis preview</h2></div>
            <span className="info" title="The modules report separate measurements; their percentages are not averaged together.">i</span>
          </div>
          <div className="module-grid">
            {(analysis?.signals ?? [
              { key: "model", label: "Document model", score: 0, detail: "Whole-document classification" },
              { key: "passage", label: "Flagged coverage", score: 0, detail: "Learned passage-level screening" },
              { key: "patterns", label: "Style context", score: 0, detail: "Rhythm, repetition, and template language" },
              { key: "guard", label: "False-positive guard", score: 0, detail: "Evidence quality and text length" },
            ] as Signal[]).map((signal) => (
              <article className={`module ${analysis ? "active" : ""}`} key={signal.key}>
                <div className={`module-icon ${signal.key}`} aria-hidden="true">{signal.key === "guard" ? "✓" : signal.key === "patterns" ? "≡" : signal.key === "passage" ? "◉" : "⌁"}</div>
                <h3>{signal.label}</h3>
                <p>{signal.detail}</p>
                <div className="meter"><span className={analysis ? moduleTone(signal, analysis) : "idle"} style={{ width: `${analysis ? signal.score : 0}%` }} /></div>
                <strong>{analysis ? `${signal.score}%` : "Waiting for document"}</strong>
              </article>
            ))}
          </div>
        </aside>
      </section>

      {analysis && (
        <section id="results" className="results" aria-live="polite">
          <div className="result-summary">
            <div className={`score-ring ${classificationTone((analysis.modelProbability ?? analysis.score / 100) * 100, analysis.thresholds ?? { human: 0.25, ai: 0.95 })}`} style={{ "--score": `${analysis.score * 3.6}deg` } as CSSProperties}>
              <div><strong>{analysis.score}<small>/100</small></strong><span>document model score</span></div>
            </div>
            <div className="summary-copy">
              <p className="eyebrow">Overall screening result</p>
              <h2>{analysis.verdict}</h2>
              <p>{analysis.wordCount.toLocaleString()} body words analyzed · {analysis.excludedWordCount.toLocaleString()} front-matter/reference words excluded · {analysis.modelVersion ?? "fallback model"}</p>
              <div className="notice"><b>Important:</b> The center range is deliberately reported as uncertain. This result is screening evidence, never proof of authorship.</div>
              <div className="score-breakdown" aria-label="Score explanation">
                <div><span>Document classification</span><strong>{analysis.score}/100</strong><small>Compared with the document model’s validated thresholds</small></div>
                <div><span>Flagged passage coverage</span><strong>{analysis.passageScan?.sufficientText === false ? "Insufficient text" : `${analysis.passageScan?.coveragePercent ?? 0}%`}</strong><small>{analysis.passageScan?.flaggedWindowCount ?? 0} of {analysis.passageScan?.windows.length ?? 0} learned windows crossed the passage boundary</small></div>
                <div><span>Personal writing profile</span><strong>Not enabled</strong><small>This scan used no personal samples; optional profiling remains a future module</small></div>
              </div>
              <div
                className="threshold-scale"
                style={{
                  "--document": `${analysis.score}%`,
                  "--human": `${(analysis.thresholds?.human ?? 0.25) * 100}%`,
                  "--ai": `${(analysis.thresholds?.ai ?? 0.95) * 100}%`,
                } as CSSProperties}
                aria-label={`Document score ${analysis.score} out of 100. Low-signal boundary ${((analysis.thresholds?.human ?? 0.25) * 100).toFixed(1)}. AI-pattern boundary ${((analysis.thresholds?.ai ?? 0.95) * 100).toFixed(1)}.`}
              >
                <div className="scale-track"><span className="score-marker"><b>{analysis.score}</b></span></div>
                <div className="scale-labels"><span>Low signal</span><span>Uncertain</span><span>AI-pattern match</span></div>
                <p>The document model examines the complete body text. Passage coverage comes from a separate learned model, and neither value is an average of the style indicators.</p>
              </div>
            </div>
          </div>

          <div className="results-grid">
            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">Passage review</p><h2>Learned passage analysis</h2></div><span>{analysis.passageScan?.flaggedWindowCount ?? 0}/{analysis.passageScan?.windows.length ?? 0}</span></div>
              <p className="panel-explainer">Overlapping 180-word windows are scored by {analysis.passageScan?.modelVersion ?? "the local passage model"}. Coverage counts the unique body words inside windows that crossed its validated AI-pattern boundary.</p>
              {analysis.passageScan?.sufficientText === false ? (
                <div className="passage-empty">At least 80 body words are needed for passage-level analysis. The document result above can still be reviewed, but no coverage percentage is inferred.</div>
              ) : (
              <div className="paragraph-list passage-list">
                {displayedPassages.map((passage) => (
                  <details key={`${passage.startWord}-${passage.endWord}`} open={passage.level === "AI-pattern match"}>
                    <summary>
                      <span>Words {passage.startWord + 1}–{passage.endWord}</span>
                      <b className={passage.level === "AI-pattern match" ? "risk" : passage.level === "Review range" ? "watch" : "safe"}>{passage.level} · {passage.score}/100</b>
                    </summary>
                    <blockquote>{passage.text}</blockquote>
                    <p className="passage-note">{passage.level === "AI-pattern match"
                      ? `This window crossed the passage model boundary of ${((analysis.passageScan?.thresholds.ai ?? 0.95) * 100).toFixed(1)}/100.`
                      : passage.level === "Review range"
                        ? "This window falls between the passage model’s low-signal and AI-pattern boundaries; it does not count as flagged coverage."
                        : "This is one of the highest-scoring low-signal windows shown for context; it does not count as flagged coverage."}</p>
                  </details>
                ))}
                {!displayedPassages.length && <div className="passage-empty">No passage windows were available for display.</div>}
              </div>
              )}
              <details className="style-details">
                <summary><span>Separate style context</span><b>{analysis.styleScore}/100</b></summary>
                <p className="panel-explainer">This heuristic describes rhythm, repetition, and template language. It is not AI probability and is not included in either learned-model score.</p>
                <div className="paragraph-list compact">
                  {analysis.paragraphs.map((paragraph, index) => (
                    <div className="style-row" key={`${index}-${paragraph.text.slice(0, 20)}`}>
                      <span>Paragraph {index + 1}</span><b className={scoreTone(paragraph.score)}>{paragraph.level} · {paragraph.score}/100</b>
                    </div>
                  ))}
                </div>
              </details>
            </section>

            <aside className="panel recommendations">
              <p className="eyebrow">Human review checklist</p>
              <h2>Recommended changes</h2>
              <ol>{analysis.recommendations.map((item) => <li key={item}>{item}</li>)}</ol>
              <button type="button" className="secondary-button" onClick={() => { setAnalysis(null); setFile(null); if (inputRef.current) inputRef.current.value = ""; window.scrollTo({ top: 0, behavior: "smooth" }); }}>Check another document</button>
            </aside>
          </div>
        </section>
      )}

      <footer>
        <p><b>Method:</b> separate local document and passage models plus style context and conservative abstention.</p>
        <p>No uploads · No accounts · No stored documents</p>
      </footer>
    </main>
  );
}
