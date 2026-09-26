import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '@/lib/auth'
import { safeNext } from '@/lib/next'
import { useDocumentTitle } from '@/ui'
import { AuthFlow, EntranceShell, PROGRESS } from '@/ui/entrance'

/**
 * The entrance. Email, code, and — only for an account without one — a name; then straight on to
 * where the person was going (a validated path on this origin), or home, which opens their sprint.
 */
export function SignIn() {
  useDocumentTitle('Sign in')
  const { me, refresh, sessionEnded, offline } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [progress, setProgress] = useState<number>(PROGRESS.email)
  // A live session never sees the entrance (an expired one being renewed, or offline, does).
  useEffect(() => {
    if (me && !sessionEnded && !offline) nav(next, { replace: true })
  }, [me, sessionEnded, offline, nav, next])
  return (
    <EntranceShell progress={progress}>
      <AuthFlow
        onProgress={setProgress}
        onDone={async () => {
          await refresh()
          nav(next, { replace: true })
        }}
      />
    </EntranceShell>
  )
}
