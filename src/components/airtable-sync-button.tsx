'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Database } from 'lucide-react'

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
export function AirtableSyncButton({ collapsed = false }: { collapsed?: boolean } = {}) {
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
        const headline = `Reconciled ${s.reconciled} loans · pushed ${s.pushedFieldsTotal} → Airtable · pulled ${s.pulledFieldsTotal} → portal · ${s.skippedNoAirtableRow} no match · ${s.errors} errors`
        // When errors dominate, surface the first sample error message so the
        // admin can paste it back without digging through Vercel logs.
        if (s.errors > 0 && s.errorSample && s.errorSample.length > 0) {
          console.error('Airtable sync errors (sample):', s.errorSample)
          const firstErr = s.errorSample[0]?.error ?? 'unknown error'
          toast.error(`${headline}\nFirst error: ${firstErr.slice(0, 220)}`, {
            id: toastId, duration: 20000,
          })
        } else {
          toast.success(headline, { id: toastId, duration: 10000 })
        }
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

  if (collapsed) {
    return (
      <Button variant="outline" size="icon-sm" onClick={handleSync} disabled={syncing}
        aria-label="Sync Airtable" title="Sync Airtable">
        <Database className={syncing ? 'animate-pulse' : ''} />
      </Button>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      {syncing ? 'Syncing…' : 'Sync Airtable'}
    </Button>
  )
}
