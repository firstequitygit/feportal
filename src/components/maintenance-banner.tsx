'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  enabled: boolean
  message: string
  isSuperAdmin: boolean
  /** Bumps when the message or enabled flag changes, so a previous dismissal doesn't suppress a new banner. */
  signature: string
}

const STORAGE_KEY = 'fe-maintenance-banner-dismissed'

export function MaintenanceBanner({ enabled, message, isSuperAdmin, signature }: Props) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = sessionStorage.getItem(STORAGE_KEY)
    setDismissed(stored === signature)
  }, [signature])

  if (!enabled || isSuperAdmin || !message || dismissed) return null

  return (
    <div
      role="status"
      className="w-full bg-yellow-100 border-b border-yellow-300 px-4 py-2 flex items-start gap-3 text-sm text-yellow-900"
    >
      <div className="flex-1">{message}</div>
      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem(STORAGE_KEY, signature)
          setDismissed(true)
        }}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 hover:bg-yellow-200 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
