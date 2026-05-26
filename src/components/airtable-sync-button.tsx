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
 * Admin sidebar button. Runs the same batch the hourly cron uses — the
 * next ~250 stalest loans, oldest-first. Useful for forcing a refresh
 * without waiting for the top of the hour.
 *
 * Full-base sync isn't a thing anymore: ~2000 loans × 1s/loan exceeds
 * even Pro's 5-min function timeout. Cron handles full coverage on a
 * rolling basis (~10 hours per full pass); this button accelerates it
 * by one batch when needed.
 *
 * For instant single-loan sync (e.g., after editing a field), use the
 * per-loan 'Sync to Airtable' button on the admin loan detail page.
 */
export function AirtableSyncButton({ collapsed = false }: { collapsed?: boolean } = {}) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    const toastId = toast.loading('Syncing next batch of stalest loans…')
    try {
      const res = await fetch('/api/admin/sync-airtable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.ok && data.summary) {
        const s = data.summary as BatchSummary
        const headline = `Synced ${s.reconciled} of ${s.total} loans · pushed ${s.pushedFieldsTotal} → Airtable · pulled ${s.pulledFieldsTotal} → portal · ${s.skippedNoAirtableRow} no match · ${s.errors} errors`
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
        aria-label="Sync next batch" title="Sync next batch of stalest loans">
        <Database className={syncing ? 'animate-pulse' : ''} />
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSync}
      disabled={syncing}
      title="Sync the next batch of stalest loans to Airtable (~250 loans). Hourly cron also runs this automatically."
    >
      {syncing ? 'Syncing…' : 'Sync Next Batch'}
    </Button>
  )
}
