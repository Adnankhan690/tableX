import type { ReactNode } from 'react'

/** Shared page heading, so the five screens agree on spacing. */
export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
      <div className="min-w-0">
        <h1 className="text-base font-semibold leading-tight">{title}</h1>
        {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </header>
  )
}
