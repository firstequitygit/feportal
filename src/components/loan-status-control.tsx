'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { LoanStatus } from '@/lib/types'

interface Props {
  loanId: string
  currentStatus: LoanStatus
  cancellationReason: string | null
}

function badgeClass(status: LoanStatus): string {
  switch (status) {
    case 'on_hold':   return 'bg-amber-100 text-amber-800 border border-amber-200'
    case 'cancelled': return 'bg-red-100 text-red-800 border border-red-200'
    default:          return 'bg-emerald-50 text-emerald-700 border border-emerald-100'
  }
}

function badgeLabel(status: LoanStatus): string {
  switch (status) {
    case 'on_hold':   return 'On Hold'
    case 'cancelled': return 'Cancelled'
    default:          return 'Active'
  }
}

// LO/LP/UW + admin all use this control. Permissions are enforced in the API,
// not here — anyone landing on the loan detail page has already passed
// assignment checks.
export function LoanStatusControl({ loanId, currentStatus, cancellationReason }: Props) {
  const router = useRouter()
  const [showCancelPrompt, setShowCancelPrompt] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function updateStatus(status: LoanStatus, reasonText?: string) {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/loans/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, status, reason: reasonText ?? null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Failed to update status')
        setSaving(false)
        return
      }
      setShowCancelPrompt(false)
      setReason('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
    setSaving(false)
  }

  function handleHold() {
    if (!confirm('Place this loan on hold? It stays in its current pipeline stage but is marked paused.')) return
    updateStatus('on_hold')
  }

  function handleResume() {
    if (!confirm('Resume this loan? Status returns to Active.')) return
    updateStatus('active')
  }

  function handleStartCancel() {
    setReason('')
    setError(null)
    setShowCancelPrompt(true)
  }

  function handleConfirmCancel() {
    updateStatus('cancelled', reason.trim() || undefined)
  }

  function handleReactivate() {
    if (!confirm('Reactivate this cancelled loan? It will be unarchived and reopened in Pipedrive.')) return
    updateStatus('active')
  }

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">Status:</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass(currentStatus)}`}>
          {badgeLabel(currentStatus)}
        </span>

        {currentStatus === 'active' && (
          <>
            <button
              onClick={handleHold}
              disabled={saving}
              className="ml-auto text-xs border border-amber-300 text-amber-800 hover:bg-amber-50 px-2 py-1 rounded-md disabled:opacity-50"
            >
              Place On Hold
            </button>
            <button
              onClick={handleStartCancel}
              disabled={saving}
              className="text-xs border border-red-300 text-red-700 hover:bg-red-50 px-2 py-1 rounded-md disabled:opacity-50"
            >
              Cancel Loan
            </button>
          </>
        )}

        {currentStatus === 'on_hold' && (
          <>
            <button
              onClick={handleResume}
              disabled={saving}
              className="ml-auto text-xs border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-md disabled:opacity-50"
            >
              Resume
            </button>
            <button
              onClick={handleStartCancel}
              disabled={saving}
              className="text-xs border border-red-300 text-red-700 hover:bg-red-50 px-2 py-1 rounded-md disabled:opacity-50"
            >
              Cancel Loan
            </button>
          </>
        )}

        {currentStatus === 'cancelled' && (
          <button
            onClick={handleReactivate}
            disabled={saving}
            className="ml-auto text-xs border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-md disabled:opacity-50"
          >
            Reactivate
          </button>
        )}
      </div>

      {currentStatus === 'cancelled' && cancellationReason && (
        <p className="text-xs text-red-700 mt-2">
          <span className="font-medium">Reason:</span> {cancellationReason}
        </p>
      )}

      {showCancelPrompt && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Cancellation reason (optional)
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Underwriting denial, bad appraisal, purchase contract cancelled…"
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <div className="flex gap-2">
            <button
              onClick={handleConfirmCancel}
              disabled={saving}
              className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Cancelling…' : 'Confirm Cancellation'}
            </button>
            <button
              onClick={() => { setShowCancelPrompt(false); setReason(''); setError(null) }}
              disabled={saving}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5"
            >
              Keep Loan Active
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
