import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '@/lib/auth'
import { safeNext } from '@/lib/next'
import { useDocumentTitle } from '@/ui'
import { AuthFlow, EntranceShell, PROGRESS } from '@/ui/entrance'

/**
 * The entrance: continue with a passkey (or create an account), then straight on to where the
 * person was going (a validated path on this origin), or home. Old links that asked for the email
 * path (`?method=email`) land here too, on the passkey sign-in: there is no other way in.
 */
export function SignIn() {
  useDocumentTitle('Sign in')
  const { me, refresh, sessionEnded, offline } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [progress, setProgress] = useState<number>(PROGRESS.start)
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
