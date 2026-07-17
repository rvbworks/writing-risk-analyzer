import type { ChangeEvent, CSSProperties, DragEvent } from "react";
import { useMemo, useRef, useState } from "react";
import mammoth from "mammoth/mammoth.browser";
import { Analysis, Signal, analyzeDocument, scoreTone, words } from "./analyzer";
import { loadBrowserModel, modelProbability } from "./browser-model";

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const fileLabel = useMemo(() => file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "No file selected", [file]);

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
      if (words(result.value).length < 40) throw new Error("The document needs at least 40 words for a useful scan.");
      const model = await loadBrowserModel();
      setAnalysis(analyzeDocument(result.value, modelProbability(result.value, model), model.version));
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
            <span className="info" title="Each module contributes a separate signal. Conflicting evidence lowers confidence.">i</span>
          </div>
          <div className="module-grid">
            {(analysis?.signals ?? [
              { key: "model", label: "Learned model", score: 0, detail: "Character-pattern classifier" },
              { key: "predictability", label: "Predictability", score: 0, detail: "Rhythm, repetition, and variation" },
              { key: "patterns", label: "Writing patterns", score: 0, detail: "Structure and template language" },
              { key: "guard", label: "False-positive guard", score: 0, detail: "Evidence quality and text length" },
            ] as Signal[]).map((signal) => (
              <article className={`module ${analysis ? "active" : ""}`} key={signal.key}>
                <div className={`module-icon ${signal.key}`} aria-hidden="true">{signal.key === "guard" ? "✓" : signal.key === "patterns" ? "≡" : signal.key === "predictability" ? "◉" : "⌁"}</div>
                <h3>{signal.label}</h3>
                <p>{signal.detail}</p>
                <div className="meter"><span className={analysis ? scoreTone(signal.score, signal.key === "guard") : "idle"} style={{ width: `${analysis ? signal.score : 0}%` }} /></div>
                <strong>{analysis ? `${signal.score}%` : "Waiting for document"}</strong>
              </article>
            ))}
          </div>
        </aside>
      </section>

      {analysis && (
        <section id="results" className="results" aria-live="polite">
          <div className="result-summary">
            <div className={`score-ring ${scoreTone(analysis.score)}`} style={{ "--score": `${analysis.score * 3.6}deg` } as CSSProperties}>
              <div><strong>{analysis.score}%</strong><span>risk signal</span></div>
            </div>
            <div className="summary-copy">
              <p className="eyebrow">Overall screening result</p>
              <h2>{analysis.verdict}</h2>
              <p>{analysis.wordCount.toLocaleString()} body words analyzed · {analysis.excludedWordCount.toLocaleString()} front-matter/reference words excluded · {analysis.modelVersion ?? "fallback model"}</p>
              <div className="notice"><b>Important:</b> The center range is deliberately reported as uncertain. This result is screening evidence, never proof of authorship.</div>
            </div>
          </div>

          <div className="results-grid">
            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">Passage review</p><h2>Paragraph signals</h2></div><span>{analysis.paragraphs.length}</span></div>
              <div className="paragraph-list">
                {analysis.paragraphs.map((paragraph, index) => (
                  <details key={`${index}-${paragraph.text.slice(0, 20)}`} open={paragraph.level === "Elevated"}>
                    <summary>
                      <span>Paragraph {index + 1}</span>
                      <b className={scoreTone(paragraph.score)}>{paragraph.level} · {paragraph.score}%</b>
                    </summary>
                    <blockquote>{paragraph.text.length > 420 ? `${paragraph.text.slice(0, 420)}…` : paragraph.text}</blockquote>
                    <ul>{paragraph.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  </details>
                ))}
              </div>
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
        <p><b>Method:</b> local learned character-pattern model plus structural explanations and conservative abstention.</p>
        <p>No uploads · No accounts · No stored documents</p>
      </footer>
    </main>
  );
}
