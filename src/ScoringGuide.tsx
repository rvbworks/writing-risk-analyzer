const SCORING_DOCUMENT_URL = "https://github.com/rvbworks/writing-risk-analyzer/blob/main/SCORING.md";

export default function ScoringGuide() {
  return (
    <section id="scoring-guide" className="scoring-guide" aria-labelledby="scoring-guide-heading">
      <div className="guide-heading">
        <div>
          <p className="eyebrow">Plain-language guide</p>
          <h2 id="scoring-guide-heading">What each score means</h2>
        </div>
        <a className="documentation-link" href={SCORING_DOCUMENT_URL} target="_blank" rel="noreferrer">
          Read the full scoring guide <span aria-hidden="true">↗</span>
        </a>
      </div>

      <p className="guide-lead">
        You will see four different results. Each one answers a different question. Do not add them together or average them.
      </p>

      <div className="guide-grid">
        <article>
          <span className="guide-number">01</span>
          <h3>Overall pattern score</h3>
          <p>The app checks the whole paper for writing patterns that showed up more often in its AI training examples. A higher score means a stronger match. It does not tell you how much AI was used.</p>
          <dl>
            <div><dt>Fewer matches</dt><dd>0–54</dd></div>
            <div><dt>No clear answer</dt><dd>55–87</dd></div>
            <div><dt>Strong match</dt><dd>88–100</dd></div>
          </dl>
        </article>

        <article>
          <span className="guide-number">02</span>
          <h3>Text in flagged sections</h3>
          <p>The app also checks overlapping groups of about 180 words. A group is flagged only when it reaches the strict 94.30 cutoff.</p>
          <p className="guide-note">This number shows how much of the paper sits inside flagged groups. A result of 0% means no group was flagged.</p>
        </article>

        <article>
          <span className="guide-number">03</span>
          <h3>Writing style notes</h3>
          <p>This check looks for repeated wording, sentences with a similar rhythm, stock transitions, and formula-like phrases.</p>
          <p className="guide-note">These notes can help with editing. They do not change the first two results.</p>
        </article>

        <article>
          <span className="guide-number">04</span>
          <h3>Result quality</h3>
          <p>This check asks whether the paper has enough body text and whether the style clues generally agree.</p>
          <p className="guide-note">A stronger quality label is helpful, but it does not prove that the other scores are correct.</p>
        </article>
      </div>

      <div className="guide-example">
        <b>Example:</b> A paper with an overall score of 49/100 and 0% text in flagged sections has fewer whole-paper matches, and none of its smaller sections reached the strict cutoff. It does not mean “49% AI.”
      </div>
    </section>
  );
}
