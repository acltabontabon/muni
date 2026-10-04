import { expectedAccountId, onExpectedAccount } from '@/api/client'

/** Unsaved forms live in this tab, and leave with the person who wrote them. */
const stores = new Set<Map<string, unknown>>()

export function clearFormDrafts() {
  stores.forEach((store) => store.clear())
}

onExpectedAccount(clearFormDrafts)

/** Keys start with the account id; stale views cannot read or restore another person's edits. */
export function accountFormDrafts<T>() {
  const store = new Map<string, T>()
  stores.add(store)
  const owns = (key: string) => {
    const accountId = expectedAccountId()
    return !!accountId && key.startsWith(`${accountId}:`)
  }
  return {
    get: (key: string) => owns(key) ? store.get(key) : undefined,
    set: (key: string, value: T) => { if (owns(key)) store.set(key, value) },
    delete: (key: string) => owns(key) && store.delete(key),
  }
}
