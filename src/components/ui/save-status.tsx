'use client'

import { useEffect, useState } from 'react'

import type { AutosaveStatus } from '@/app/apply/_components/use-autosave'

function relativeTime(epoch: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - epoch) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
}

export function SaveStatus({ status }: { status: AutosaveStatus }) {
  const [, force] = useState(0)

  useEffect(() => {
    if (status.state !== 'saved') return
    const id = setInterval(() => force((n) => n + 1), 10_000)
    return () => clearInterval(id)
  }, [status.state])

  if (status.state === 'idle') return null

  const label =
    status.state === 'saving'
      ? 'Saving…'
      : status.state === 'saved'
        ? `Saved  ${relativeTime(status.at)}`
        : 'Save failed — retry'

  const tone =
    status.state === 'error'
      ? 'text-(--apply-danger,#A8332E)'
      : status.state === 'saving'
        ? 'text-(--apply-ink-muted,#64748B)'
        : 'text-(--apply-brand,#1F5D8F)'

  return (
    <span
      role="status"
      aria-live="polite"
      className={`text-[10px] uppercase tracking-[0.18em] ${tone}`}
    >
      {label}
    </span>
  )
}
