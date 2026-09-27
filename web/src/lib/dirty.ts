/** Whether the composer holds text right now (so an update never reloads under someone typing). */
let dirty = false
export const setComposerDirty = (v: boolean) => {
  dirty = v
}
export const isComposerDirty = () => dirty
