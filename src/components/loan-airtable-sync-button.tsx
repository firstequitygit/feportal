'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Database } from 'lucide-react'
import { useImpersonation } from '@/components/impersonation-provider'

/**
 * Per-loan Airtable sync. POSTs to /api/admin/sync-airtable with a
 * loanId so the backend reconciles just that one loan — fast enough
 * to complete inside Vercel's per-request timeout, unlike the
 * full-base sync.
 *
 * Available to admin + any LO/LP/UW assigned to the loan. The route
 * enforces the assignment check on the server; this component can be
 * mounted in any of the four loan detail pages.
 */
interface SyncResult {
  loanId: string
  status: 'reconciled' | 'skipped-no-deal-id' | 'skipped-no-airtable-row' | 'paused' | 'error'
  pushedToAirtable: number
  pulledToPortal: number
  error?: string
}

export function LoanAirtableSyncButton({ loanId }: { loanId: string }) {
  const router = useRouter()
  const { isImpersonating } = useImpersonation()
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    const toastId = toast.loading('Syncing this loan with Airtable…')
    try {
      const res = await fetch('/api/admin/sync-airtable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? `Sync failed (HTTP ${res.status})`, { id: toastId })
        setSyncing(false)
        return
      }
      const r = data.result as SyncResult
      if (r.status === 'reconciled') {
        toast.success(
          `Synced · pushed ${r.pushedToAirtable} → Airtable · pulled ${r.pulledToPortal} → portal`,
          { id: toastId, duration: 8000 },
        )
      } else if (r.status === 'paused') {
        // Global pause switch flipped on (src/lib/airtable.ts).
        toast.info('Airtable sync is paused — nothing was sent', { id: toastId, duration: 8000 })
      } else if (r.status === 'skipped-no-deal-id') {
        toast.error('Loan has no Pipedrive Deal ID — nothing to sync', { id: toastId })
      } else if (r.status === 'skipped-no-airtable-row') {
        toast.error('No matching Airtable record for this loan', { id: toastId })
      } else {
        toast.error(`Sync error: ${r.error ?? 'unknown'}`, { id: toastId, duration: 10000 })
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed', { id: toastId })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <button
      type="button"
      onClick={isImpersonating ? undefined : handleSync}
      disabled={syncing || isImpersonating}
      title={isImpersonating ? 'Read-only preview — exit View As to act' : undefined}
      // Must match ViewAsDropdown and the Generate Approval Letter link
      // — same pill, h-7, text-xs across the loan detail header.
      className={`inline-flex items-center gap-1.5 h-7 px-3.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${isImpersonating ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Database className={`w-3.5 h-3.5 ${syncing ? 'animate-pulse' : ''}`} />
      {syncing ? 'Syncing…' : 'Sync to Airtable'}
    </button>
  )
}
