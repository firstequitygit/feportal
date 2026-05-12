'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  loanId: string
  currentBorrowerId: string | null
  currentBorrowerName: string | null
  allBorrowers: { id: string; full_name: string; email: string }[]
  apiPath?: string
}

export function AdminBorrowerAssign({ loanId, currentBorrowerId, allBorrowers, apiPath = '/api/loans/assign-borrower' }: Props) {
  const [selected, setSelected] = useState(currentBorrowerId ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, borrowerId: selected || null }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Borrower assignment saved')
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
        <CardTitle className="text-base">Borrower Assignment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">
          Assign a borrower to give them portal access to this loan.
        </p>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— Unassigned —</option>
          {allBorrowers.map(b => (
            <option key={b.id} value={b.id}>
              {b.full_name ?? b.email} ({b.email})
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
