'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Database } from 'lucide-react'
import { useImpersonation } from '@/components/impersonation-provider'

/**
 * Per-loan Airtable sync. POSTs to the same admin endpoint as the global
 * sync button but passes a loanId so the backend reconciles just that
 * one loan — fast enough to complete inside Vercel's per-request timeout,
 * unlike the full-base sync.
 *
 * Admin-only behavior on the server. Mount this in the admin loan detail
 * page; non-admins won't see it.
 */
interface SyncResult {
  loanId: string
  status: 'reconciled' | 'skipped-no-deal-id' | 'skipped-no-airtable-row' | 'error'
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
    <Button
      variant="outline"
      size="sm"
      onClick={isImpersonating ? undefined : handleSync}
      disabled={syncing || isImpersonating}
      title={isImpersonating ? 'Read-only preview — exit View As to act' : undefined}
      className={`gap-1.5 ${isImpersonating ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Database className={`w-3.5 h-3.5 ${syncing ? 'animate-pulse' : ''}`} />
      {syncing ? 'Syncing…' : 'Sync to Airtable'}
    </Button>
  )
}
