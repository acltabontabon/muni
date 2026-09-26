import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './lib/auth'
import { SignIn } from './routes/SignIn'
import { Invite } from './routes/Invite'
import { Home } from './routes/Home'
import { WorkspacePage } from './routes/Workspace'
import { SprintSetup } from './routes/SprintSetup'
import { SprintHome } from './routes/SprintHome'
import { Prepare } from './routes/Prepare'
import { Stage } from './routes/Stage'
import { Companion } from './routes/Companion'
import { Outcomes } from './routes/Outcomes'
import { Account } from './routes/Account'
import { About } from './routes/About'
import { Spinner } from './ui'
import { LocalProvider } from './lib/local/LocalProvider'
import { OfflineStart } from './ui/status'

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
  return children
}

export function App() {
  const { me } = useAuth()
  return (
    // Keyed by account: switching people on a device starts every view afresh, so text typed by
    // one person can never be saved or sent under another.
    <LocalProvider key={me?.account_id ?? 'signed-out'} accountId={me?.account_id ?? null}>
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      {/* Invitation links carry the token in the fragment (/invite#token), which never reaches a server. */}
      <Route path="/invite" element={<Invite />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/about" element={<About />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      {/* The old bookmarkable capture link opens the same home (a ?sprint= deep link is kept). */}
      <Route path="/capture" element={<Protected><Home /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/workspaces/:workspaceId" element={<Protected><WorkspacePage /></Protected>} />
      <Route path="/workspaces/:workspaceId/sprints/new" element={<Protected><SprintSetup /></Protected>} />
      <Route path="/sprints/:sprintId" element={<Protected><SprintHome /></Protected>} />
      <Route path="/sprints/:sprintId/setup" element={<Protected><SprintSetup /></Protected>} />
      <Route path="/sprints/:sprintId/prepare" element={<Protected><Prepare /></Protected>} />
      <Route path="/sprints/:sprintId/stage" element={<Protected><Stage /></Protected>} />
      <Route path="/sprints/:sprintId/room" element={<Protected><Companion /></Protected>} />
      <Route path="/sprints/:sprintId/outcomes" element={<Protected><Outcomes /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </LocalProvider>
  )
}
