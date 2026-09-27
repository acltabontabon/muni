/**
 * Where a transcript goes in the draft. One predictable rule:
 *
 * - If the text hasn't changed since recording started, the words go where the cursor was then
 *   (the end of the draft, when the field wasn't focused).
 * - If it has changed (the writer kept typing while Muni listened or transcribed), they go at
 *   the end, so nothing typed in the meantime is moved, split or replaced.
 *
 * Existing text is never removed. A space is added only where two words would otherwise touch.
 */
export type Anchor = { body: string; caret: number }

export type Insertion =
  /** `start`/`end` bound the spoken words; `from`/`to` include any space added around them. */
  | { ok: true; body: string; start: number; end: number; from: number; to: number; text: string }
  | { ok: false; reason: 'too-long'; text: string; room: number }
  | { ok: false; reason: 'empty' }

export function anchorFor(body: string, field: { selectionStart: number; selectionEnd: number } | null, focused: boolean): Anchor {
  // A selection is never replaced by speech: the words go after it.
  const caret = field && focused ? Math.min(Math.max(field.selectionEnd, 0), body.length) : body.length
  return { body, caret }
}

export function insertTranscript(current: string, anchor: Anchor, transcript: string, max: number): Insertion {
  const said = transcript.trim()
  if (!said) return { ok: false, reason: 'empty' }
  const at = current === anchor.body ? anchor.caret : current.length
  const before = current.slice(0, at)
  const after = current.slice(at)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) ? ' ' : ''
  const piece = `${lead}${said}${trail}`
  if (current.length + piece.length > max) return { ok: false, reason: 'too-long', text: said, room: Math.max(0, max - current.length) }
  const start = before.length + lead.length
  return { ok: true, body: before + piece + after, start, end: start + said.length, from: before.length, to: before.length + piece.length, text: said }
}

/** Takes an insertion back out, only while the draft is exactly as the insertion left it. */
export function undoInsertion(current: string, ins: { body: string; from: number; to: number }): string | null {
  if (current !== ins.body) return null
  return current.slice(0, ins.from) + current.slice(ins.to)
}
