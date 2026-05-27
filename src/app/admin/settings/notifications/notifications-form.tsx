'use client'

import { useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Props {
  initialValue: string
  initialUpdatedAt: string | null
  initialUpdatedByName: string | null
}

const KEY = 'applications_processing_inbox'

export function NotificationsForm({ initialValue, initialUpdatedAt, initialUpdatedByName }: Props) {
  const [value, setValue] = useState(initialValue)
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [updatedByName, setUpdatedByName] = useState(initialUpdatedByName)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('idle')
    setErrorMsg(null)

    startTransition(async () => {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: KEY, value }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'request failed' }))
        setStatus('error')
        setErrorMsg(body.error ?? 'request failed')
        return
      }

      const refreshed = await fetch(`/api/admin/settings?key=${KEY}`, { cache: 'no-store' })
      if (refreshed.ok) {
        const data = await refreshed.json()
        setValue(data.value)
        setUpdatedAt(data.updated_at)
        setUpdatedByName(data.updated_by_name)
      }
      setStatus('saved')
    })
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <div>
        <Label htmlFor="processing-inbox">Processing inbox email</Label>
        <Input
          id="processing-inbox"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="processing@fefunding.com"
          className="mt-1.5"
          autoComplete="off"
        />
        <p className="mt-1.5 text-sm text-gray-600">
          Leave blank to send internal notices only to the assigned loan officer.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : 'Save'}
        </Button>
        {status === 'saved' && <span className="text-sm text-green-700">Saved.</span>}
        {status === 'error' && <span className="text-sm text-red-700">{errorMsg}</span>}
      </div>

      {updatedAt && (
        <p className="text-xs text-gray-500">
          Last updated {new Date(updatedAt).toLocaleString()}
          {updatedByName ? ` by ${updatedByName}` : ''}.
        </p>
      )}
    </form>
  )
}
