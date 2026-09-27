import { describe, expect, it } from 'vitest'
import { anchorFor, insertTranscript, undoInsertion } from './insert'

describe('where dictated words go', () => {
  it('fills an empty draft', () => {
    const r = insertTranscript('', anchorFor('', null, false), 'Na-stuck yung deploy kanina', 2000)
    expect(r).toMatchObject({ ok: true, body: 'Na-stuck yung deploy kanina' })
  })

  it('adds to the end of an existing draft, never replacing it', () => {
    const body = 'Staging broke on Tuesday.'
    const r = insertTranscript(body, anchorFor(body, null, false), 'Pero naayos din agad.', 2000)
    expect(r).toMatchObject({ ok: true, body: 'Staging broke on Tuesday. Pero naayos din agad.' })
  })

  it('goes where the cursor was when recording started', () => {
    const body = 'First. Third.'
    const r = insertTranscript(body, anchorFor(body, { selectionStart: 6, selectionEnd: 6 }, true), 'Second.', 2000)
    expect(r).toMatchObject({ ok: true, body: 'First. Second. Third.' })
  })

  it('never replaces a selection: the words go after it', () => {
    const body = 'keep this'
    const r = insertTranscript(body, anchorFor(body, { selectionStart: 0, selectionEnd: 4 }, true), 'and', 2000)
    expect(r).toMatchObject({ ok: true, body: 'keep and this' })
  })

  it('goes to the end when the writer kept typing meanwhile, so nothing typed is split', () => {
    const anchor = anchorFor('First. Third.', { selectionStart: 6, selectionEnd: 6 }, true)
    const r = insertTranscript('First. Third. Typed while it listened', anchor, 'Spoken.', 2000)
    expect(r).toMatchObject({ ok: true, body: 'First. Third. Typed while it listened Spoken.' })
  })

  it('does not add a space where there already is one', () => {
    const r = insertTranscript('Line one\n', anchorFor('Line one\n', null, false), 'line two', 2000)
    expect(r).toMatchObject({ ok: true, body: 'Line one\nline two' })
  })

  it('refuses rather than truncating when it would pass the limit', () => {
    const body = 'x'.repeat(1995)
    const r = insertTranscript(body, anchorFor(body, null, false), 'too many words', 2000)
    expect(r).toEqual({ ok: false, reason: 'too-long', text: 'too many words', room: 5 })
  })

  it('treats blank recognition as nothing to insert', () => {
    expect(insertTranscript('a', anchorFor('a', null, false), '  ', 2000)).toEqual({ ok: false, reason: 'empty' })
  })

  it('undo restores the text exactly, only while nothing else changed', () => {
    const body = 'First. Third.'
    const r = insertTranscript(body, anchorFor(body, { selectionStart: 6, selectionEnd: 6 }, true), 'Second.', 2000)
    if (!r.ok) throw new Error('expected insertion')
    expect(undoInsertion(r.body, r)).toBe(body)
    expect(undoInsertion(r.body + '!', r)).toBeNull()
  })
})
