/** The rhythm is available beside the real writing, without adding another onboarding gate. */
export function CaptureRhythm() {
  return <details className="capture-rhythm">
    <summary>How a thought becomes a better retro</summary>
    <ol>
      <li><span aria-hidden>01</span><div><strong>Notice it. Keep it.</strong><p>Add a win, a frustration, or an idea while it’s fresh. A sentence is enough.</p></div></li>
      <li><span aria-hidden>02</span><div><strong>See the whole picture.</strong><p>When collection closes, the team’s thoughts appear together, without names.</p></div></li>
      <li><span aria-hidden>03</span><div><strong>Try something small.</strong><p>Talk about what matters. Choose one to three experiments for the next sprint.</p></div></li>
    </ol>
  </details>
}

export function ThoughtLength({ text }: { text: string }) {
  if (text.length < 1600) return null
  return <span className="thought-length" data-full={text.length === 2000 || undefined} role="status">{2000 - text.length} characters left</span>
}
