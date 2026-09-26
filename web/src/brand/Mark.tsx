/**
 * The Muni mark: a lowercase "m" drawn as two rounded arches, the second
 * ending in a dot (the path forward), with a faint reflection beneath the
 * baseline (muni-muni: reflecting). At small sizes and in monochrome the
 * reflection is dropped; the arches and dot still read as "m".
 */
export function Mark({ size = 28, reflect = true, className = '', title = 'Muni' }: { size?: number; reflect?: boolean; className?: string; title?: string }) {
  const showReflection = reflect && size >= 24
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
        <path d="M10 40V28a8 8 0 0 1 16 0v12" />
        <path d="M26 40V28a8 8 0 0 1 16 0v12" />
      </g>
      <circle cx="52" cy="40" r="4.5" fill="var(--accent)" />
      {showReflection && (
        <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.2" transform="translate(0 92) scale(1 -1)">
          <path d="M10 40V33a8 8 0 0 1 16 0v7" />
          <path d="M26 40V33a8 8 0 0 1 16 0v7" />
        </g>
      )}
    </svg>
  )
}

export function Wordmark({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="Muni">
      <Mark size={size + 6} />
      <span className="font-wordmark tracking-tight" style={{ fontSize: size, lineHeight: 1 }}>
        muni
      </span>
    </span>
  )
}
