'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

export function SyncButton({ collapsed = false }: { collapsed?: boolean } = {}) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    const toastId = toast.loading('Syncing with Pipedrive…')
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(`Synced ${data.synced} loans`, { id: toastId })
        router.refresh()
      } else {
        toast.error(data.error ?? 'Sync failed', { id: toastId })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed', { id: toastId })
    } finally {
      setSyncing(false)
    }
  }

  if (collapsed) {
    return (
      <Button variant="outline" size="icon-sm" onClick={handleSync} disabled={syncing}
        aria-label="Sync Pipedrive" title="Sync Pipedrive">
        <RefreshCw className={syncing ? 'animate-spin' : ''} />
      </Button>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      {syncing ? 'Syncing…' : 'Sync Pipedrive'}
    </Button>
  )
}
