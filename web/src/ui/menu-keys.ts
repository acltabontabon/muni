import type { KeyboardEvent } from 'react'

/**
 * The keyboard for a menu (`role="menu"`, its items `menuitem…`): the arrow keys move between the
 * items it can use, wrapping around, and Home and End go to the first and last. The popover it sits
 * in puts focus on the first item when it opens, and Escape closes it back to its button.
 */
export function menuKeys(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')]
  if (!items.length) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next =
    e.key === 'ArrowDown' ? (at + 1) % items.length
    : e.key === 'ArrowUp' ? (at <= 0 ? items.length : at) - 1
    : e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
    : -1
  if (next < 0) return
  e.preventDefault()
  items[next].focus()
}
