'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Database } from 'lucide-react'

/**
 * Pull a human-readable string out of whatever shape "error" came back in.
 * Vercel's gateway errors look like { error: { code, message } }; our own
 * API uses a flat string. Returns null if we can't get anything useful.
 */
function stringifyError(err: unknown): string | null {
  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    if (typeof o.message === 'string' && o.message.trim()) return o.message
    if (typeof o.code === 'string' && o.code.trim()) return o.code
    try { return JSON.stringify(err).slice(0, 220) } catch { return null }
  }
  return null
}

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
      // The response is usually JSON, but Vercel returns an HTML page on
      // function timeout / gateway errors — so guard the parse.
      const raw = await res.text()
      let data: unknown
      try { data = JSON.parse(raw) } catch { data = null }
      const d = (data ?? {}) as Record<string, unknown>

      if (d.ok && d.summary) {
        const s = d.summary as BatchSummary
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
        // Coerce whatever came back (string, object with .message, HTML, etc.)
        // into a useful one-liner instead of toasting "[object Object]".
        const msg = stringifyError(d.error) ?? (res.status >= 500 ? `Server error (${res.status})${res.status === 504 ? ' — function timed out' : ''}` : `Airtable sync failed (${res.status})`)
        console.error('Airtable sync failed:', { status: res.status, body: raw.slice(0, 500) })
        toast.error(msg, { id: toastId, duration: 15000 })
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
