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
      ? 'text-red-600'
      : status.state === 'saving'
        ? 'text-gray-500'
        : 'text-emerald-700'

  return (
    <span
      role="status"
      aria-live="polite"
      className={`text-xs ${tone}`}
    >
      {label}
    </span>
  )
}
