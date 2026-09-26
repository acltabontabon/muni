/**
 * Where to go after signing in. Only a path on this origin is accepted: anything that could leave
 * the app (`//host`, `/\host`, `https:`, control characters) or loop back to sign-in becomes `/`.
 */
export function safeNext(raw: string | null | undefined, origin = window.location.origin): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what's refused
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\u0000-\u001f\\]/.test(raw)) return '/'
  try {
    const u = new URL(raw, origin)
    if (u.origin !== origin || u.pathname === '/signin') return '/'
    return u.pathname + u.search + u.hash
  } catch {
    return '/'
  }
}
