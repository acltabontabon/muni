import { Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import { useAuth } from './lib/auth'
import { SignIn } from './routes/SignIn'
import { Invite } from './routes/Invite'
import { Join, JoinStatus } from './routes/Join'
import { Home } from './routes/Home'
import { WorkspaceLayout } from './routes/workspace/Layout'
import { WorkspaceSprints } from './routes/workspace/Sprints'
import { SprintPage } from './routes/SprintPage'
import { Companion } from './routes/Companion'
import { Suspense, useState } from 'react'
import { Spinner, useDocumentTitle } from './ui'
import { EntranceShell, NameStep, PROGRESS } from './ui/entrance'
import { lazyPart, Loading, PageBoundary } from './ui/lazy'
import { LeaveDialog } from './ui/menus'
import { LocalProvider } from './lib/local/LocalProvider'
import { ResourceProvider } from './lib/resource'
import { OfflineStart } from './ui/status'
import { isPersonalPath, WorldProvider } from './worlds/world'
import { CharacterGate } from './worlds/Character'

// What a phone opens most — home, a sprint's page, the retro companion, signing in and joining —
// is in the first load. The rest loads when it's first opened.
const Stage = lazyPart(() => import('./routes/Stage'), (m) => m.Stage)
const Prepare = lazyPart(() => import('./routes/Prepare'), (m) => m.Prepare)
const SprintSetup = lazyPart(() => import('./routes/SprintSetup'), (m) => m.SprintSetup)
const Account = lazyPart(() => import('./routes/Account'), (m) => m.Account)
const Privacy = lazyPart(() => import('./routes/Privacy'), (m) => m.Privacy)
const About = lazyPart(() => import('./routes/About'), (m) => m.About)
const WhatsNew = lazyPart(() => import('./routes/About'), (m) => m.WhatsNew)
const WorkspacePeople = lazyPart(() => import('./routes/workspace/People'), (m) => m.WorkspacePeople)
const WorkspaceSettings = lazyPart(() => import('./routes/workspace/Settings'), (m) => m.WorkspaceSettings)

/** The old address of a sprint's outcomes: a finished sprint's page is its outcomes now. */
function OutcomesRedirect() {
  const { sprintId = '' } = useParams()
  return <Navigate to={`/sprints/${sprintId}`} replace />
}

function Protected({ children }: { children: React.ReactElement }) {
  const { me, loading, offline } = useAuth()
  const loc = useLocation()
  if (loading)
    return (
      <div className="grid min-h-dvh place-items-center text-ink-soft">
        <Spinner />
      </div>
    )
  // Offline with nothing kept on this device: say so, rather than showing a sign-in that can't work.
  if (!me && offline) return <OfflineStart />
  if (!me) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  // Verified but no name chosen yet (an interrupted first sign-in): finish that here, on the same URL,
  // so the deep link is kept and nothing else is reachable first.
  if (me.needs_name && !offline) return <NameGate />
  // A new account's first visit to its own pages: choose a character (or decide later). Never in
  // front of a shared page someone was sent to (a room, a join link), and never offline.
  if (me.avatar?.intro === 'choose' && !offline && isPersonalPath(loc.pathname)) return <CharacterGate />
  return children
}

function NameGate() {
  const { refresh } = useAuth()
  const [leaving, setLeaving] = useState(false)
  useDocumentTitle('Your name')
  return (
    <EntranceShell progress={PROGRESS.name}>
      <NameStep
        onDone={async () => {
          await refresh()
        }}
        footer={
          <p className="quiet mt-4">
            Not you? <button type="button" className="entrance-link" onClick={() => setLeaving(true)}>Sign out</button>
            <LeaveDialog kind={leaving ? 'signout' : null} onClose={() => setLeaving(false)} />
          </p>
        }
      />
    </EntranceShell>
  )
}

/** A failure on one page stays on that page: going elsewhere starts afresh. */
function RouteBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return <PageBoundary at={pathname}>{children}</PageBoundary>
}

export function App() {
  const { me } = useAuth()
  return (
    // Keyed by account: switching people on a device starts every view afresh, so text typed by
    // one person can never be saved or sent under another, and what one person's pages read (the
    // resource cache) is never shown to the next.
    <WorldProvider>
    <LocalProvider key={me?.account_id ?? 'signed-out'} accountId={me?.account_id ?? null}>
    <ResourceProvider>
    <RouteBoundary>
    <Suspense fallback={<Loading page />}>
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      {/* Invitation links carry the token in the fragment (/invite#token), which never reaches a server. */}
      <Route path="/invite" element={<Invite />} />
      <Route path="/invite/:token" element={<Invite />} />
      {/* A shared team QR or link: /join#token. Asks to join; someone on the team approves. */}
      <Route path="/join" element={<Join />} />
      <Route path="/join/requests/:requestId" element={<Protected><JoinStatus /></Protected>} />
      <Route path="/privacy" element={<Privacy />} />
      {/* Public, like Privacy. /about was the privacy page's earlier address: its section links still land there. */}
      <Route path="/about" element={<About />} />
      <Route path="/about/whats-new" element={<WhatsNew />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      {/* The old bookmarkable capture link: the same shortcut to your sprint (a ?sprint= deep link is kept). */}
      <Route path="/capture" element={<Protected><Home /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      {/* One opening for the workspace's sections: it stays in place while only the section changes. */}
      <Route path="/workspaces/:workspaceId" element={<Protected><WorkspaceLayout /></Protected>}>
        <Route index element={<WorkspaceSprints />} />
        <Route path="people" element={<WorkspacePeople />} />
        <Route path="settings" element={<WorkspaceSettings />} />
      </Route>
      <Route path="/workspaces/:workspaceId/sprints/new" element={<Protected><SprintSetup /></Protected>} />
      {/* A sprint's one home: writing, the closed state, the retro and the outcomes. */}
      <Route path="/sprints/:sprintId" element={<Protected><SprintPage /></Protected>} />
      <Route path="/sprints/:sprintId/setup" element={<Protected><SprintSetup /></Protected>} />
      <Route path="/sprints/:sprintId/prepare" element={<Protected><Prepare /></Protected>} />
      <Route path="/sprints/:sprintId/stage" element={<Protected><Stage /></Protected>} />
      <Route path="/sprints/:sprintId/room" element={<Protected><Companion /></Protected>} />
      {/* Outcomes are a finished sprint's page now; old links still land there. */}
      <Route path="/sprints/:sprintId/outcomes" element={<Protected><OutcomesRedirect /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </RouteBoundary>
    </ResourceProvider>
    </LocalProvider>
    </WorldProvider>
  )
}
