'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface BatchSummary {
  total: number
  updated: number
  skippedNoDealId: number
  skippedNoAirtableRow: number
  errors: number
  errorSample?: Array<{ loanId: string; error: string }>
}

/**
 * Admin-only one-click button that fires the Portal → Airtable Deals sync.
 * Mirrors SyncButton (Pipedrive) styling/UX, but talks to a different
 * endpoint and surfaces a richer summary toast because the sync can produce
 * four distinct outcomes per loan.
 */
export function AirtableSyncButton() {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    const toastId = toast.loading('Syncing Loan Details to Airtable…')
    try {
      const res = await fetch('/api/admin/sync-airtable', { method: 'POST' })
      const data = await res.json()
      if (data.ok && data.summary) {
        const s = data.summary as BatchSummary
        toast.success(
          `Airtable: ${s.updated} updated · ${s.skippedNoAirtableRow} no match · ${s.errors} errors`,
          { id: toastId, duration: 8000 },
        )
        router.refresh()
      } else {
        toast.error(data.error ?? 'Airtable sync failed', { id: toastId })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Airtable sync failed', { id: toastId })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      {syncing ? 'Syncing…' : 'Sync Airtable'}
    </Button>
  )
}
