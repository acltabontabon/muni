/**
 * Whether the composer holds work right now (so an update never reloads under someone typing):
 * text in the field, or a recording being made or transcribed.
 */
let dirty = false
let voice = false
export const setComposerDirty = (v: boolean) => {
  dirty = v
}
export const setVoiceBusy = (v: boolean) => {
  voice = v
}
export const isComposerDirty = () => dirty || voice
