'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  loanId: string
  currentBrokerId: string | null
  allBrokers: { id: string; full_name: string | null; email: string; company_name: string | null }[]
}

export function BrokerAssign({ loanId, currentBrokerId, allBrokers }: Props) {
  const [selected, setSelected] = useState(currentBrokerId ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/loans/assign-broker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, brokerId: selected || null }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Broker assignment saved')
      } else {
        toast.error(data.error ?? 'Failed to save assignment')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Broker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">
          When a broker is assigned, the broker is the portal contact and all notifications go to them
          instead of the borrower. The borrower&apos;s information stays in the file for record-keeping.
        </p>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— No broker (direct to borrower) —</option>
          {allBrokers.map(b => (
            <option key={b.id} value={b.id}>
              {b.full_name ?? b.email}{b.company_name ? ` · ${b.company_name}` : ''} ({b.email})
            </option>
          ))}
        </select>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Assignment'}
        </Button>
      </CardContent>
    </Card>
  )
}
