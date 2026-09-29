import { useEffect, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react'
import { Mark } from '@/brand/Mark'
import { APP_VERSION, RELEASES, releaseDate, type ReleaseNotes, type Span } from '@/lib/release'
import { useDocumentTitle } from '@/ui'
import { InfoShell } from '@/ui/shell'

/** A link's #section, readable; a malformed one ("#%") is just no section. */
const fragment = (hash: string) => {
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return ''
  }
}

/**
 * About Muni: what it is, which version this is, the way to what's new, and the places that
 * actually exist for help and feedback. Public, like Privacy. Every link here is real: the website,
 * the public repository (Apache-2.0) and its issues, and the maintainer's Ko-fi (.github/FUNDING.yml).
 *
 * /about was once the privacy page's address; its old section links (/about#visibility) still land
 * on Privacy.
 */
const REPO = 'https://github.com/acltabontabon/muni'
const PRIVACY_SECTIONS = ['collect', 'visibility', 'team', 'authorship', 'operator', 'providers', 'encryption', 'device', 'retention', 'controls', 'contact']

/** "muni-muni" in Baybayin (ᜋᜓ mu · ᜈᜒ ni), as on the sign-in. */
const BAYBAYIN = 'ᜋᜓᜈᜒ ᜋᜓᜈᜒ'

export function About() {
  useDocumentTitle('About Muni')
  const { hash } = useLocation()
  if (PRIVACY_SECTIONS.includes(fragment(hash))) return <Navigate to={`/privacy${hash}`} replace />
  const latest = RELEASES[0]
  return (
    <InfoShell>
      <article className="about mx-auto max-w-2xl pb-16">
        <header className="about-head">
          <Mark size={56} title="Muni" />
          <p className="about-define">
            <i lang="tl">muni-muni</i>
            <span className="about-define-sep" aria-hidden> · </span>
            <span className="about-define-gloss">Filipino, to reflect; to turn a thought over.</span>
            <span className="about-baybayin" lang="tl-Tglg" aria-hidden title="muni-muni, in Baybayin">{BAYBAYIN}</span>
          </p>
          <h1 className="about-title">About Muni</h1>
          <p className="about-lede">
            Muni helps a team keep what happens during a sprint and bring it to the retrospective. You write
            a thought while it’s fresh; when collection closes, everyone’s thoughts arrive together, without
            names, and the retro becomes a conversation about what to change.
          </p>
        </header>

        <Waterline />

        <section aria-labelledby="about-version" className="about-version">
          <h2 id="about-version" className="sr-only">Version</h2>
          <p className="about-version-line">
            <span className="about-version-label">Version</span>
            <span className="about-version-number">{APP_VERSION}</span>
            {latest?.version === APP_VERSION && latest.prerelease ? <span className="about-tag">Release candidate</span> : null}
          </p>
          {latest ? (
            <Link to="/about/whats-new" className="about-new">
              <span className="about-new-kicker">What’s new{latest.version === APP_VERSION ? '' : ` in ${latest.version}`}</span>
              <span className="about-new-list">{leads(latest).slice(0, 4).join(' · ')}</span>
              <ArrowRight className="about-new-arrow" aria-hidden />
            </Link>
          ) : null}
        </section>

        <section aria-labelledby="about-elsewhere" className="about-links">
          <h2 id="about-elsewhere" className="about-eyebrow">Elsewhere</h2>
          <ul>
            <Out href="https://munimuni.app" title="munimuni.app" detail="The website: what Muni is for, in a few minutes." />
            <Out href={`${REPO}/issues`} title="Feedback and problems" detail="Tell us what’s confusing or broken, on GitHub." />
            <Out href={REPO} title="Source code" detail="Open source under the Apache License 2.0." />
            <Out href="https://ko-fi.com/aclt_attic" title="Support Muni" detail="It’s built and run by one person. A coffee helps." />
          </ul>
        </section>

        <footer className="about-foot">
          <Link to="/privacy">Privacy &amp; data</Link>
          <a href="/third-party-licenses.txt">Third-party licenses</a>
          <span>Built and run by Alvin Cris Tabontabon.</span>
        </footer>
      </article>
    </InfoShell>
  )
}

/** A sun half set on a hairline, its light on the water: the evening from the sign-in, in one stroke. */
function Waterline() {
  return (
    <div className="about-waterline" aria-hidden>
      <svg viewBox="0 0 120 40" focusable="false">
        <defs>
          <clipPath id="about-sky"><rect x="0" y="0" width="120" height="24" /></clipPath>
        </defs>
        <circle cx="60" cy="24" r="17" className="about-halo" clipPath="url(#about-sky)" />
        <circle cx="60" cy="24" r="9.5" className="about-sun" clipPath="url(#about-sky)" />
        <rect x="52" y="28" width="16" height="1.6" rx="0.8" className="about-glint" />
        <rect x="55.5" y="32" width="9" height="1.6" rx="0.8" className="about-glint" />
        <rect x="58" y="36" width="4" height="1.6" rx="0.8" className="about-glint" />
      </svg>
    </div>
  )
}

/** The bold leads of a release's first section: "Write while it's fresh", … */
function leads(r: ReleaseNotes): string[] {
  const items = r.sections[0]?.items ?? []
  return items.map((i) => (i[0]?.t === 'strong' ? i[0].v : i.map((s) => s.v).join('')).replace(/[.:]\s*$/, ''))
}

function Out({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <li>
      <a href={href} className="about-out" rel="noopener">
        <span className="about-out-title">{title}</span>
        <span className="about-out-detail">{detail}</span>
        <ArrowUpRight className="about-out-arrow" aria-hidden />
      </a>
    </li>
  )
}

/** What's new: every release, newest first, as CHANGELOG.md has it — Added, Changed, Fixed… — with a bold-led first section shown as highlights. */
export function WhatsNew() {
  useDocumentTitle('What’s new in Muni')
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(fragment(hash))?.scrollIntoView()
  }, [hash])
  return (
    <InfoShell>
      <article className="whatsnew mx-auto max-w-2xl pb-16">
        <nav aria-label="Back">
          <Link to="/about" className="whatsnew-back"><ArrowLeft className="size-4" aria-hidden /> About Muni</Link>
        </nav>
        <h1 className="about-title mt-6">What’s new</h1>
        {RELEASES.length > 1 ? (
          <nav aria-label="Releases" className="whatsnew-index">
            <ol>
              {RELEASES.map((r) => (
                <li key={r.version}>
                  <a href={`#v${r.version}`}>{r.version}</a> <span>{releaseDate(r.date)}</span>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {RELEASES.length ? RELEASES.map((r, i) => <ReleaseEntry key={r.version} r={r} first={i === 0} />) : <p className="mt-6 text-ink-soft">Release notes will appear here.</p>}
      </article>
    </InfoShell>
  )
}

function ReleaseEntry({ r, first }: { r: ReleaseNotes; first: boolean }) {
  const [lead, ...rest] = r.sections
  const isHighlights = !!lead && lead.items.every((i) => i[0]?.t === 'strong')
  return (
    <section id={`v${r.version}`} aria-labelledby={`v${r.version}-t`} className="whatsnew-release" data-first={first || undefined}>
      <header className="whatsnew-release-head">
        <h2 id={`v${r.version}-t`} className="whatsnew-version">
          <span className="sr-only">Version </span>{r.version}
        </h2>
        <p className="whatsnew-meta">
          <time dateTime={r.date}>{releaseDate(r.date)}</time>
          {r.prerelease ? <span className="about-tag">Release candidate</span> : null}
          {r.version === APP_VERSION ? <span className="whatsnew-current">You’re using this version</span> : null}
        </p>
      </header>
      {r.prerelease ? <p className="whatsnew-p">A release candidate for Muni {r.version.replace(/-.*$/, '')}: this is what runs now, and {r.version.replace(/-.*$/, '')} follows once it has passed its final checks.</p> : null}
      {lead && isHighlights ? (
        <>
        <h3 className="about-eyebrow whatsnew-kind">{lead.title}</h3>
        <ol className="whatsnew-highlights" aria-label={lead.title}>
          {lead.items.map((item, i) => {
            const [title, ...body] = item
            return (
              <li key={i}>
                <span className="whatsnew-n" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                <h3 className="whatsnew-h">{title.v.replace(/[.:]\s*$/, '')}</h3>
                <p><Spans spans={trimStart(body)} /></p>
              </li>
            )
          })}
        </ol>
        </>
      ) : null}
      {(lead && isHighlights ? rest : r.sections).map((s) => (
        <div key={s.title} className="whatsnew-section">
          <h3 className="about-eyebrow">{s.title}</h3>
          <ul>
            {s.items.map((item, i) => <li key={i}><Spans spans={item} /></li>)}
          </ul>
        </div>
      ))}
    </section>
  )
}

const trimStart = (spans: Span[]): Span[] => (spans[0]?.t === 'text' ? [{ ...spans[0], v: spans[0].v.replace(/^\s+/, '') }, ...spans.slice(1)] : spans)

function Spans({ spans }: { spans: Span[] }): ReactNode {
  return spans.map((s, i) =>
    s.t === 'strong' ? <strong key={i}>{s.v}</strong> : s.t === 'em' ? <em key={i}>{s.v}</em> : s.t === 'link' ? <Anchor key={i} href={s.href}>{s.v}</Anchor> : s.v,
  )
}

/** Links to Muni's own pages stay in the app; everything else opens as a normal link. */
function Anchor({ href, children }: { href: string; children: ReactNode }) {
  const own = href.startsWith('/') ? href : href.startsWith(`${window.location.origin}/`) ? href.slice(window.location.origin.length) : null
  const inApp = own ?? (href.startsWith('https://act.munimuni.app/') ? href.slice('https://act.munimuni.app'.length) : null)
  return inApp ? <Link to={inApp}>{children}</Link> : <a href={href} rel="noopener">{children}</a>
}
