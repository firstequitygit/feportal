'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface BatchSummary {
  total: number
  reconciled: number
  pushedFieldsTotal: number
  pulledFieldsTotal: number
  skippedNoDealId: number
  skippedNoAirtableRow: number
  errors: number
  errorSample?: Array<{ loanId: string; error: string }>
}

/**
 * Admin-only one-click button that fires the bidirectional Loan Details
 * sync between the portal and the Airtable Deals base. Model B: fill blanks
 * only — never overwrite a populated field on either side.
 */
export function AirtableSyncButton() {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    const toastId = toast.loading('Reconciling Loan Details with Airtable…')
    try {
      const res = await fetch('/api/admin/sync-airtable', { method: 'POST' })
      const data = await res.json()
      if (data.ok && data.summary) {
        const s = data.summary as BatchSummary
        toast.success(
          `Reconciled ${s.reconciled} loans · pushed ${s.pushedFieldsTotal} → Airtable · pulled ${s.pulledFieldsTotal} → portal · ${s.skippedNoAirtableRow} no match · ${s.errors} errors`,
          { id: toastId, duration: 10000 },
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
