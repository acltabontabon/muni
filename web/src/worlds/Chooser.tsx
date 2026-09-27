/**
 * Choosing a character: eight portraits (a radio group: arrow keys, one tab stop, named for screen
 * readers), a live miniature of the chosen world built from the real design, and the lore — one
 * line, then the longer story on request. Used for a new account's first visit, and in settings.
 *
 * Nothing is saved until the person confirms; previewing changes only this panel (and, on the
 * full-page first visit, the page around it).
 */
import { useId, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { Check, Info } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/ui'
import { ABOUT_CHARACTERS, AVATAR_IDS, CHARACTERS, type AvatarId, type Character } from './characters'
import { Portrait } from './portraits'
import { WorldPreview } from './WorldPreview'

/** Starts loading a world's display face for its preview (nothing is cached for later). */
function peek(id: AvatarId) {
  try {
    void document.fonts?.load(`1em "${CHARACTERS[id].world.font}"`).catch(() => {})
  } catch {
    /* no font loading API */
  }
}

/** "Inspired by everyday Filipino life", with the details a person can open if they want them. */
export function CultureNote({ character }: { character?: Character | null }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="w-culture">
          <Info className="size-3.5" aria-hidden /> Inspired by everyday Filipino life
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} className="z-50 w-[min(26rem,calc(100vw-24px))] rounded-2xl border border-line bg-card p-4 text-sm leading-relaxed text-ink shadow-[var(--shadow-float)] anim-rise">
          <p className="font-medium">About these characters</p>
          <p className="mt-1.5 text-ink-soft">{ABOUT_CHARACTERS}</p>
          {character ? <p className="mt-2 text-ink-soft"><span className="font-medium text-ink">{character.meaning}.</span> {character.context}</p> : null}
          <p className="mt-2 text-ink-soft">
            The names: {AVATAR_IDS.map((id) => CHARACTERS[id].meaning).join(' · ')}.
          </p>
          <p className="mt-2 text-xs text-ink-faint">Original characters and artwork made for Muni.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** A character's story: the line, then (on request) the rest. */
export function Lore({ c, headingLevel = 2 }: { c: Character; headingLevel?: 2 | 3 }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const H = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className="w-lore">
      <H className="w-lore-name">
        {c.name} <span className="w-lore-title">{c.title}</span>
      </H>
      <p className="w-lore-line">{c.line}</p>
      <button type="button" className="w-lore-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? 'Less' : `Read ${c.name}’s story`}
      </button>
      <div id={id} hidden={!open} className="w-lore-story">
        <p>{c.bio}</p>
        <p className="mt-2 text-ink-soft"><span className="font-medium text-ink">Fun fact.</span> {c.funFact}</p>
      </div>
    </div>
  )
}

export function Chooser({
  initial,
  onConfirm,
  onLater,
  onPreview,
  confirmLabel = (c) => `Choose ${c.name}`,
  laterLabel = 'Decide later',
  busy,
  disabled,
  note,
}: {
  initial: AvatarId
  onConfirm: (id: AvatarId) => void
  onLater?: () => void
  onPreview?: (id: AvatarId) => void
  confirmLabel?: (c: Character) => string
  laterLabel?: string
  busy?: boolean
  disabled?: boolean
  note?: string | null
}) {
  const [sel, setSel] = useState<AvatarId>(initial)
  const c = CHARACTERS[sel]
  const pick = (id: AvatarId) => {
    setSel(id)
    onPreview?.(id)
    peek(id)
  }
  return (
    <div className="w-chooser">
      <div className="w-chooser-pick">
        <RadioGroup.Root value={sel} onValueChange={(v) => pick(v as AvatarId)} aria-label="Characters" className="w-tiles" orientation="horizontal" loop>
          {AVATAR_IDS.map((id) => {
            const x = CHARACTERS[id]
            return (
              <RadioGroup.Item key={id} value={id} className="w-tile" aria-label={`${x.name}, ${x.title}`} onMouseEnter={() => peek(id)} onFocus={() => peek(id)}>
                <span className="w-tile-portrait">
                  <Portrait id={id} size={72} />
                  <RadioGroup.Indicator className="w-tile-check">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  </RadioGroup.Indicator>
                </span>
                <span className="w-tile-name" aria-hidden>{x.name}</span>
              </RadioGroup.Item>
            )
          })}
        </RadioGroup.Root>
        <Lore c={c} key={c.id} />
      </div>
      <div className="w-chooser-see">
        <p className="w-chooser-world">
          <span className="text-ink-faint">{c.name}’s world · </span>
          <span className="font-medium text-ink">{c.world.name}</span>
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">{c.world.summary}</p>
        <WorldPreview id={sel} className="w-preview-frame mt-3" />
      </div>
      <div className="w-chooser-actions">
        <CultureNote character={c} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {note ? <p className="w-full text-right text-sm text-ink-soft sm:w-auto">{note}</p> : null}
          {onLater ? (
            <Button type="button" variant="ghost" onClick={onLater} disabled={busy || disabled}>
              {laterLabel}
            </Button>
          ) : null}
          <Button type="button" variant="primary" className={clsx('min-w-40')} busy={busy} disabled={disabled} onClick={() => onConfirm(sel)}>
            {confirmLabel(c)}
          </Button>
        </div>
      </div>
    </div>
  )
}
