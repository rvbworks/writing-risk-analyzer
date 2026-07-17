import type { ChangeEvent, CSSProperties, DragEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { Analysis, Signal, analyzeDocument, classificationTone, modelInputText, scoreTone, words } from "./analyzer";
import { loadBrowserModel, loadPassageModel, modelProbability, scorePassages } from "./browser-model";
import ScoringGuide from "./ScoringGuide";

function moduleTone(signal: Signal, analysis: Analysis) {
  if (signal.key === "model") return classificationTone((analysis.modelProbability ?? signal.score / 100) * 100, analysis.thresholds ?? { human: 0.25, ai: 0.95 });
  if (signal.key === "passage") return signal.score === 0 ? "safe" : signal.score < 25 ? "watch" : "risk";
  return scoreTone(signal.score, signal.key === "guard");
}

function signalResult(signal: Signal) {
  if (signal.key === "model") return `${signal.score}/100`;
  if (signal.key === "passage") return `${signal.score}% of text`;
  if (signal.key === "patterns") return `${signal.score}/100 style flags`;
  return signal.score >= 70 ? "Strong result quality" : signal.score >= 45 ? "Fair result quality" : "Limited result quality";
}

function passageLabel(level: string) {
  if (level === "AI-pattern match") return "Strong match";
  if (level === "Review range") return "Needs a closer look";
  return "Fewer pattern matches";
}

function styleLabel(level: string) {
  if (level === "Elevated") return "Many style flags";
  if (level === "Moderate") return "Some style flags";
  return "Few style flags";
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
      const mammoth = await import("mammoth/mammoth.browser")
        .then((module) => module.default)
        .catch(() => { throw new Error("The Word reader could not load. Connect to the internet once, refresh the page, and try again."); });
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      const analysisText = modelInputText(result.value);
      if (words(analysisText).length < 80) throw new Error("The paper needs at least 80 body words after the cover page, headings, and references are removed.");
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
        <div className="header-actions">
          <a className="guide-link" href="#scoring-guide">Understand the scores</a>
          <div className="privacy-badge" title="Your document is processed on this device and is not uploaded.">
            <span aria-hidden="true">✓</span> Runs locally in your browser
          </div>
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
            <div><p className="eyebrow">A clue, not proof</p><h2>What the results will show</h2></div>
            <span className="info" title="Each result means something different. The numbers are not averaged together.">i</span>
          </div>
          <div className="module-grid">
            {(analysis?.signals ?? [
              { key: "model", label: "Overall pattern score", score: 0, detail: "Checks the writing patterns in the whole paper" },
              { key: "passage", label: "Text in flagged sections", score: 0, detail: "Shows how much text is inside strongly matched sections" },
              { key: "patterns", label: "Writing style notes", score: 0, detail: "Looks for repeated or formula-like writing" },
              { key: "guard", label: "Result quality", score: 0, detail: "Checks whether there is enough text for a useful result" },
            ] as Signal[]).map((signal) => (
              <article className={`module ${analysis ? "active" : ""}`} key={signal.key}>
                <div className={`module-icon ${signal.key}`} aria-hidden="true">{signal.key === "guard" ? "✓" : signal.key === "patterns" ? "≡" : signal.key === "passage" ? "◉" : "⌁"}</div>
                <h3>{signal.label}</h3>
                <p>{signal.detail}</p>
                <div className="meter"><span className={analysis ? moduleTone(signal, analysis) : "idle"} style={{ width: `${analysis ? signal.score : 0}%` }} /></div>
                <strong>{analysis ? signalResult(signal) : "Waiting for a paper"}</strong>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <ScoringGuide />

      {analysis && (
        <section id="results" className="results" aria-live="polite">
          <div className="result-summary">
            <div className={`score-ring ${classificationTone((analysis.modelProbability ?? analysis.score / 100) * 100, analysis.thresholds ?? { human: 0.25, ai: 0.95 })}`} style={{ "--score": `${analysis.score * 3.6}deg` } as CSSProperties}>
              <div><strong>{analysis.score}<small>/100</small></strong><span>overall pattern score</span></div>
            </div>
            <div className="summary-copy">
              <p className="eyebrow">Overall result</p>
              <h2>{analysis.verdict}</h2>
              <p>{analysis.wordCount.toLocaleString()} body words checked · {analysis.excludedWordCount.toLocaleString()} cover-page and reference words skipped</p>
              <div className="notice"><b>Important:</b> A score in the middle does not give a clear answer. This tool looks for writing patterns; it cannot prove who wrote the paper.</div>
              <div className="score-breakdown" aria-label="Score explanation">
                <div><span>Overall pattern score</span><strong>{analysis.score}/100</strong><small>How closely the whole paper matches patterns learned from training examples</small></div>
                <div><span>Text in flagged sections</span><strong>{analysis.passageScan?.sufficientText === false ? "Not enough text" : `${analysis.passageScan?.coveragePercent ?? 0}%`}</strong><small>{analysis.passageScan?.flaggedWindowCount ?? 0} of {analysis.passageScan?.windows.length ?? 0} sections reached the strict cutoff</small></div>
                <div><span>Personal writing comparison</span><strong>Off</strong><small>This paper was not compared with any earlier writing samples</small></div>
              </div>
              <div
                className="threshold-scale"
                style={{
                  "--document": `${analysis.score}%`,
                  "--human": `${(analysis.thresholds?.human ?? 0.25) * 100}%`,
                  "--ai": `${(analysis.thresholds?.ai ?? 0.95) * 100}%`,
                } as CSSProperties}
                aria-label={`Overall pattern score ${analysis.score} out of 100. Scores through ${Math.floor((analysis.thresholds?.human ?? 0.25) * 100)} show fewer matches. Scores at ${Math.ceil((analysis.thresholds?.ai ?? 0.95) * 100)} or higher show a strong match.`}
              >
                <div className="scale-track"><span className="score-marker"><b>{analysis.score}</b></span></div>
                <div className="scale-labels"><span>Fewer matches</span><span>No clear answer</span><span>Strong match</span></div>
                <p>The overall score checks the whole paper. The flagged-text number checks smaller sections. The style notes are separate. These results are not averaged together.</p>
                <a className="inline-guide-link" href="#scoring-guide">See what each score means</a>
              </div>
            </div>
          </div>

          <div className="results-grid">
            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">Section review</p><h2>Sections to look at</h2></div><span>{analysis.passageScan?.flaggedWindowCount ?? 0}/{analysis.passageScan?.windows.length ?? 0} flagged</span></div>
              <p className="panel-explainer">The app checks overlapping groups of about 180 words. A section is flagged only when it reaches the strict 94.30 cutoff. Words that appear in two overlapping sections are counted once.</p>
              {analysis.passageScan?.sufficientText === false ? (
                <div className="passage-empty">The paper needs at least 80 body words before the app can check smaller sections.</div>
              ) : (
              <div className="paragraph-list passage-list">
                {displayedPassages.map((passage) => (
                  <details key={`${passage.startWord}-${passage.endWord}`} open={passage.level === "AI-pattern match"}>
                    <summary>
                      <span>Words {passage.startWord + 1}–{passage.endWord}</span>
                      <b className={passage.level === "AI-pattern match" ? "risk" : passage.level === "Review range" ? "watch" : "safe"}>{passageLabel(passage.level)} · {passage.score}/100</b>
                    </summary>
                    <blockquote>{passage.text}</blockquote>
                    <p className="passage-note">{passage.level === "AI-pattern match"
                      ? `This section reached the strict cutoff of ${((analysis.passageScan?.thresholds.ai ?? 0.95) * 100).toFixed(1)}/100. Review it, but do not treat the result as proof of AI writing.`
                      : passage.level === "Review range"
                        ? "This section is in the middle range. It is shown for context, but it does not count as flagged text."
                        : "This is one of the paper's highest low-range sections. It is shown for context, but it does not count as flagged text."}</p>
                  </details>
                ))}
                {!displayedPassages.length && <div className="passage-empty">There were no sections to show.</div>}
              </div>
              )}
              <details className="style-details">
                <summary><span>Writing style notes</span><b>{analysis.styleScore}/100 style flags</b></summary>
                <p className="panel-explainer">This separate check looks for repeated or formula-like writing. It is not an AI percentage, and it does not change the overall score or the flagged-text number.</p>
                <div className="paragraph-list compact">
                  {analysis.paragraphs.map((paragraph, index) => (
                    <details className="style-row-details" key={`${index}-${paragraph.text.slice(0, 20)}`}>
                      <summary>
                        <span>Paragraph {index + 1}</span><b className={scoreTone(paragraph.score)}>{styleLabel(paragraph.level)} · {paragraph.score}/100</b>
                      </summary>
                      <ul>{paragraph.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                    </details>
                  ))}
                </div>
              </details>
            </section>

            <aside className="panel recommendations">
              <p className="eyebrow">Next steps</p>
              <h2>What to review</h2>
              <ol>{analysis.recommendations.map((item) => <li key={item}>{item}</li>)}</ol>
              <button type="button" className="secondary-button" onClick={() => { setAnalysis(null); setFile(null); if (inputRef.current) inputRef.current.value = ""; window.scrollTo({ top: 0, behavior: "smooth" }); }}>Check another document</button>
            </aside>
          </div>
        </section>
      )}

      <footer>
        <p><b>How it works:</b> the app checks the whole paper, then looks at smaller sections and writing style.</p>
        <p><a href="#scoring-guide">Understand the scores</a> · No uploads · No accounts · No stored documents</p>
      </footer>
    </main>
  );
}
