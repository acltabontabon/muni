import { clsx } from 'clsx'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react'

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
export function Button({ variant = 'secondary', size = 'md', className, busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none whitespace-nowrap select-none'
  const sizes = { sm: 'h-9 px-3.5 text-sm', md: 'h-11 px-5 text-[15px]', lg: 'h-13 px-7 text-base' }
  const variants: Record<Variant, string> = {
    // Disabled: a quiet paper shape, not a greyed-out block of ink.
    primary: 'bg-[var(--action)] text-[var(--action-ink)] hover:bg-[color-mix(in_oklab,var(--action)_84%,var(--accent))] shadow-[0_1px_0_rgb(0_0_0/0.08)] disabled:bg-[var(--card-2)] disabled:text-[var(--ink-faint)] disabled:shadow-none',
    secondary: 'bg-card border border-line text-ink hover:bg-paper disabled:opacity-50',
    ghost: 'bg-transparent text-ink hover:bg-ink/5 disabled:opacity-50',
    danger: 'bg-transparent border border-danger/40 text-danger hover:bg-danger/10 disabled:opacity-50',
    quiet: 'bg-transparent text-ink-soft hover:text-ink underline-offset-4 hover:underline px-2 disabled:opacity-50',
  }
  return (
    // While busy it stays disabled whatever `disabled` says: a second press never sends twice.
    <button {...rest} className={clsx(base, sizes[size], variants[variant], className)} aria-busy={busy || undefined} disabled={busy || rest.disabled}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={clsx('inline-block size-4 rounded-full border-2 border-current border-r-transparent animate-spin', className)} />
}

// ---------- Fields ----------
export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-ink mb-1.5">
      {children}
      {hint ? <span className="ml-2 font-normal text-ink-soft">{hint}</span> : null}
    </label>
  )
}

const inputClass = 'w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[15px] placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60'
export function Input({ className, ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={clsx(inputClass, className)} {...rest} />
}
export function Textarea({ className, ref, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={clsx(inputClass, 'resize-y min-h-24', className)} {...rest} />
}
export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputClass, 'appearance-none pr-9 bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23615b54%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_12px_center]', className)} {...rest}>
      {children}
    </select>
  )
}

export function Help({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx('text-sm text-ink-soft mt-1.5', className)}>{children}</p>
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="text-sm text-danger mt-2">
      {children}
    </p>
  )
}

// ---------- Switch ----------
export function Switch({ checked, onCheckedChange, label, description, id, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; id: string; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <SwitchPrimitive.Root id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5 relative h-6 w-10 shrink-0 rounded-full bg-ink/20 data-[state=checked]:bg-accent transition-colors disabled:opacity-50">
        <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
      <label htmlFor={id} className="cursor-pointer">
        <div className="text-[15px] font-medium">{label}</div>
        {description ? <div className="text-sm text-ink-soft">{description}</div> : null}
      </label>
    </div>
  )
}

// ---------- Chip radio group ----------
export function ChipGroup<T extends string>({ value, onChange, options, label, allowNone }: { value: T | null; onChange: (v: T | null) => void; options: { id: T; label: string; hint?: string; color?: string }[]; label: string; allowNone?: boolean }) {
  return (
    <RadioGroup.Root value={value ?? ''} onValueChange={(v) => onChange((v || null) as T | null)} aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <RadioGroup.Item
          key={o.id}
          value={o.id}
          title={o.hint}
          onClick={() => {
            if (allowNone && value === o.id) onChange(null)
          }}
          className="group inline-flex h-9 items-center gap-2 rounded-full border border-line bg-card px-3 text-sm text-ink-soft transition-colors hover:border-ink/30 data-[state=checked]:text-ink data-[state=checked]:border-[var(--chip)] data-[state=checked]:bg-[color-mix(in_oklab,var(--chip)_12%,var(--card))]"
          style={{ ['--chip' as string]: o.color ?? 'var(--accent)' }}
        >
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: o.color ?? 'var(--accent)' }} />
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}

// ---------- Category badge ----------
export function CategoryDot({ color, label, small }: { color: string; label: string; small?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 font-medium', small ? 'text-xs' : 'text-sm')} style={{ color }}>
      <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'; className?: string }) {
  const tones = { neutral: 'bg-ink/6 text-ink-soft', accent: 'bg-accent-soft text-accent-ink', ok: 'bg-ok/12 text-ok', warn: 'bg-warn/15 text-warn', danger: 'bg-danger/12 text-danger' }
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-paper px-1.5 py-0.5 font-sans text-[11px] text-ink-soft">{children}</kbd>
}

// ---------- Dialog ----------
export function Dialog({ open, onOpenChange, title, description, children, wide, size, onOpenAutoFocus, onCloseAutoFocus }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; wide?: boolean; size?: 'xl'; onOpenAutoFocus?: (e: Event) => void; onCloseAutoFocus?: (e: Event) => void }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40 anim-fade backdrop-blur-[2px]" />
        <DialogPrimitive.Content onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus} className={clsx('fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-6 shadow-[var(--shadow-float)] border border-line anim-settle max-h-[calc(100dvh-32px)] overflow-y-auto', size === 'xl' ? 'max-w-5xl max-sm:p-4' : wide ? 'max-w-2xl' : 'max-w-md')}>
          <div className="flex items-start justify-between gap-4">
            <DialogPrimitive.Title className="font-display text-xl leading-tight">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-full p-1.5 text-ink-soft hover:bg-ink/6" aria-label="Close">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          {description ? <DialogPrimitive.Description className="mt-2 text-ink-soft">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">Dialog</DialogPrimitive.Description>}
          <div className="mt-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; tone: 'ok' | 'info' | 'danger' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, text, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'danger' ? 7000 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto anim-rise rounded-full px-4 py-2 text-sm shadow-[var(--shadow-float)] border', t.tone === 'danger' ? 'bg-card border-danger/40 text-danger' : 'bg-ink text-paper border-transparent')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

// ---------- Layout helpers ----------
export function EmptyState({ title, children, action, art }: { title: ReactNode; children?: ReactNode; action?: ReactNode; art?: ReactNode }) {
  return (
    <div className="card p-8 text-center">
      {art ? <div className="mx-auto mb-4 text-ink-faint">{art}</div> : null}
      <h3 className="font-display text-xl">{title}</h3>
      {children ? <div className="mt-2 text-ink-soft measure mx-auto">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="font-display text-xl leading-tight">{children}</h2>
      {aside ? <div className="text-sm text-ink-soft">{aside}</div> : null}
    </div>
  )
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title
    document.title = title ? `${title} · Muni` : 'Muni'
    return () => {
      document.title = prev
    }
  }, [title])
}

export function useCountdown(endsAt: string | null | undefined, remainingSecs: number, serverTime: string | undefined) {
  // Derive the clock from the server's instant, corrected by the skew observed at snapshot time.
  const skew = useMemo(() => (serverTime ? Date.parse(serverTime) - Date.now() : 0), [serverTime])
  const [now, setNow] = useState(Date.now())
  const secs = endsAt ? Math.max(0, Math.round((Date.parse(endsAt) - (now + skew)) / 1000)) : remainingSecs
  // Wake only when the shown second changes (not on a fixed interval): one render a second, and
  // none once it reaches zero.
  useEffect(() => {
    if (!endsAt || secs <= 0) return
    const left = Date.parse(endsAt) - (Date.now() + skew)
    const wait = ((left - 500) % 1000 + 1000) % 1000 || 1000
    const t = window.setTimeout(() => setNow(Date.now()), wait + 15)
    return () => window.clearTimeout(t)
  }, [endsAt, skew, secs, now])
  return secs
}

export function fmtClock(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function fmtDate(d: string) {
  return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
