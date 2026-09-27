/**
 * Where a person meets and manages their character: the first-visit chooser (new accounts, once),
 * the dialog to change it from anywhere, the settings block, and the one quiet note for accounts
 * from before characters existed. Everything here is about the person's own preference; nothing
 * is shown to their team.
 */
import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Wordmark } from '@/brand/Mark'
import { useAuth } from '@/lib/auth'
import { Button, Dialog, Switch, useDocumentTitle } from '@/ui'
import { AVATAR_IDS, DEFAULT_AVATAR, type AvatarId } from './characters'
import { Chooser, CultureNote, Lore } from './Chooser'
import { Portrait } from './portraits'
import { useWorld } from './world'

/** A new account's first page: choose who keeps you company (or decide later). */
export function CharacterGate() {
  const { choose, finishIntro } = useWorld()
  const [preview, setPreview] = useState<AvatarId>(DEFAULT_AVATAR)
  const [busy, setBusy] = useState(false)
  useDocumentTitle('Choose a character')
  return (
    <div className="w-scope w-gate" data-world={preview}>
      <header className="w-gate-top">
        <Wordmark size={20} />
      </header>
      <main className="w-gate-main">
        <h1 className="w-gate-title">
          Choose a character. <em>Step into their world.</em>
        </h1>
        <p className="w-gate-lead">Make room for your own thoughts. Your character dresses your own pages only — your team never sees it — and you can change it any time.</p>
        <Chooser
          initial={DEFAULT_AVATAR}
          onPreview={setPreview}
          busy={busy}
          onConfirm={async (id) => {
            setBusy(true)
            if (!(await choose(id))) setBusy(false)
          }}
          onLater={async () => {
            setBusy(true)
            if (!(await finishIntro())) setBusy(false)
          }}
        />
      </main>
    </div>
  )
}

/** The chooser in a dialog, from settings or the account menu. Opened through useWorld(). */
export function CharacterDialog() {
  const { chooserOpen, setChooserOpen, character, choose } = useWorld()
  const { offline } = useAuth()
  const [busy, setBusy] = useState(false)
  // Focus goes back where it was when the dialog opened (the account button, or the settings button).
  const back = useRef<HTMLElement | null>(null)
  return (
    <Dialog
      open={chooserOpen}
      onOpenChange={(o) => !busy && setChooserOpen(o)}
      size="xl"
      title="Choose a character"
      description="Your character dresses your own writing page and collection. Nobody on your team sees it."
      onOpenAutoFocus={() => {
        back.current = document.activeElement as HTMLElement | null
      }}
      onCloseAutoFocus={(e) => {
        const el = back.current
        back.current = null
        const target = el && el.isConnected ? el : document.querySelector<HTMLElement>('[data-account-trigger]')
        if (target) {
          e.preventDefault()
          target.focus()
        }
      }}
    >
      <Chooser
        initial={character?.id ?? DEFAULT_AVATAR}
        busy={busy}
        disabled={offline}
        note={offline ? 'Changing your character needs a connection.' : null}
        confirmLabel={(c) => (character?.id === c.id ? `Keep ${c.name}` : `Choose ${c.name}`)}
        onConfirm={async (id) => {
          if (id === character?.id) return setChooserOpen(false)
          setBusy(true)
          const ok = await choose(id)
          setBusy(false)
          if (ok) setChooserOpen(false)
        }}
      />
    </Dialog>
  )
}

/** Settings → Character. */
export function CharacterSettings() {
  const { character, themeOn, setThemeOn, setChooserOpen } = useWorld()
  const { offline } = useAuth()
  if (!character)
    return (
      <div>
        <p className="max-w-prose text-[15px] text-ink-soft">No character yet. Choose one to give your writing page and collection their own world.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setChooserOpen(true)} disabled={offline}>Choose a character</Button>
          <span className="flex -space-x-2" aria-hidden>
            {AVATAR_IDS.slice(0, 4).map((id) => <Portrait key={id} id={id} size={32} className="rounded-full ring-2 ring-[var(--paper)]" />)}
          </span>
        </div>
        {offline ? <p className="mt-2 text-sm text-ink-soft">Choosing a character needs a connection.</p> : null}
        <div className="mt-4"><CultureNote /></div>
      </div>
    )
  return (
    <div>
      <div className="flex items-start gap-4">
        <Portrait id={character.id} size={80} className="shrink-0" />
        <Lore c={character} headingLevel={3} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => setChooserOpen(true)} disabled={offline}>Change character</Button>
      </div>
      <div className="mt-3">
        <Switch
          id="avatar-theme"
          checked={themeOn}
          disabled={offline}
          onCheckedChange={(on) => void setThemeOn(on)}
          label="Use avatar theme"
          description={`Your writing page and collection take on ${character.name}’s world. Off: Muni’s standard look and words; ${character.name} stays your avatar. Light and dark follow Appearance either way.`}
        />
      </div>
      {offline ? <p className="text-sm text-ink-soft">Changing your character needs a connection.</p> : null}
      <div className="mt-3"><CultureNote character={character} /></div>
    </div>
  )
}

/** Accounts from before characters: one quiet line, dismissed for good. */
export function CharacterNote() {
  const { intro, character, setChooserOpen, finishIntro } = useWorld()
  const { offline } = useAuth()
  if (intro !== 'note' || character || offline) return null
  return (
    <div className="w-note mb-5" role="note">
      <span className="flex shrink-0 -space-x-2" aria-hidden>
        {(['kape', 'bola', 'sibol'] as const).map((id) => <Portrait key={id} id={id} size={28} className="rounded-full ring-2 ring-[var(--card)]" />)}
      </span>
      <p className="min-w-0 flex-1">Muni has characters now. Choose one to give your writing page its own world.</p>
      <Button size="sm" onClick={() => setChooserOpen(true)}>Choose</Button>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => void finishIntro()}>
        <X className="size-4" />
      </button>
    </div>
  )
}
