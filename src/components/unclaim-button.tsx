'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  loanId: string
  /** API endpoint that handles the unclaim, e.g. '/api/loan-officer/unclaim'. */
  apiEndpoint: string
  /** Where to send the user after a successful unclaim — usually their loans list. */
  redirectTo: string
  /** Role label used in the confirmation copy ("loan officer", "loan processor", "underwriter"). */
  roleLabel: string
}

/**
 * Small destructive-style button that releases the current user's claim
 * on a loan. Uses native confirm() to avoid taking a dependency on a
 * dialog primitive — keep it simple. After success, navigates to the
 * caller's loans list (since they no longer have access to this loan).
 */
export function UnclaimButton({ loanId, apiEndpoint, redirectTo, roleLabel }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Release this loan from your queue? Another ${roleLabel} will be able to claim it. ` +
        `You will lose access until you (or another) claim it again.`,
      )
      if (!ok) return
    }
    setLoading(true)
    setError(null)
    const res = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      router.push(redirectTo)
      router.refresh()
    } else {
      setError(data.error ?? 'Failed to unclaim loan')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Releasing...' : 'Unclaim loan'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
