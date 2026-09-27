import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './lib/auth'
import { SignIn } from './routes/SignIn'
import { Invite } from './routes/Invite'
import { Join, JoinStatus } from './routes/Join'
import { Home } from './routes/Home'
import { WorkspaceLayout } from './routes/workspace/Layout'
import { WorkspaceSprints } from './routes/workspace/Sprints'
import { WorkspacePeople } from './routes/workspace/People'
import { WorkspaceSettings } from './routes/workspace/Settings'
import { SprintSetup } from './routes/SprintSetup'
import { SprintHome } from './routes/SprintHome'
import { Prepare } from './routes/Prepare'
import { Stage } from './routes/Stage'
import { Companion } from './routes/Companion'
import { Outcomes } from './routes/Outcomes'
import { Account } from './routes/Account'
import { Privacy } from './routes/Privacy'
import { useState } from 'react'
import { Spinner, useDocumentTitle } from './ui'
import { EntranceShell, NameStep, PROGRESS } from './ui/entrance'
import { LeaveDialog } from './ui/menus'
import { LocalProvider } from './lib/local/LocalProvider'
import { ResourceProvider } from './lib/resource'
import { OfflineStart } from './ui/status'
import { isPersonalPath, WorldProvider } from './worlds/world'
import { CharacterGate } from './worlds/Character'

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

function ToPrivacy() {
  const { hash } = useLocation()
  return <Navigate to={`/privacy${hash}`} replace />
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

export function App() {
  const { me } = useAuth()
  return (
    // Keyed by account: switching people on a device starts every view afresh, so text typed by
    // one person can never be saved or sent under another, and what one person's pages read (the
    // resource cache) is never shown to the next.
    <WorldProvider>
    <LocalProvider key={me?.account_id ?? 'signed-out'} accountId={me?.account_id ?? null}>
    <ResourceProvider>
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      {/* Invitation links carry the token in the fragment (/invite#token), which never reaches a server. */}
      <Route path="/invite" element={<Invite />} />
      <Route path="/invite/:token" element={<Invite />} />
      {/* A shared team QR or link: /join#token. Asks to join; someone on the team approves. */}
      <Route path="/join" element={<Join />} />
      <Route path="/join/requests/:requestId" element={<Protected><JoinStatus /></Protected>} />
      <Route path="/privacy" element={<Privacy />} />
      {/* The privacy page's earlier address. */}
      <Route path="/about" element={<ToPrivacy />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      {/* The old bookmarkable capture link opens the same home (a ?sprint= deep link is kept). */}
      <Route path="/capture" element={<Protected><Home /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      {/* One opening for the workspace's sections: it stays in place while only the section changes. */}
      <Route path="/workspaces/:workspaceId" element={<Protected><WorkspaceLayout /></Protected>}>
        <Route index element={<WorkspaceSprints />} />
        <Route path="people" element={<WorkspacePeople />} />
        <Route path="settings" element={<WorkspaceSettings />} />
      </Route>
      <Route path="/workspaces/:workspaceId/sprints/new" element={<Protected><SprintSetup /></Protected>} />
      <Route path="/sprints/:sprintId" element={<Protected><SprintHome /></Protected>} />
      <Route path="/sprints/:sprintId/setup" element={<Protected><SprintSetup /></Protected>} />
      <Route path="/sprints/:sprintId/prepare" element={<Protected><Prepare /></Protected>} />
      <Route path="/sprints/:sprintId/stage" element={<Protected><Stage /></Protected>} />
      <Route path="/sprints/:sprintId/room" element={<Protected><Companion /></Protected>} />
      <Route path="/sprints/:sprintId/outcomes" element={<Protected><Outcomes /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ResourceProvider>
    </LocalProvider>
    </WorldProvider>
  )
}
