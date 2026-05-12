'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { type LoanProcessor } from '@/lib/types'

interface Props {
  loanId: string
  currentLoanProcessorId: string | null
  allLoanProcessors: LoanProcessor[]
}

export function AdminLoanProcessorAssign({ loanId, currentLoanProcessorId, allLoanProcessors }: Props) {
  const [selected, setSelected] = useState(currentLoanProcessorId ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/assign-loan-processor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, loanProcessorId: selected || null }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Loan processor assignment saved')
      } else {
        toast.error(data.error ?? 'Failed to save assignment')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const current = allLoanProcessors.find(lp => lp.id === selected)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Loan Processor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— Unassigned —</option>
          {allLoanProcessors.map(lp => (
            <option key={lp.id} value={lp.id}>
              {lp.full_name}{lp.title ? ` — ${lp.title}` : ''}
            </option>
          ))}
        </select>

        {current && (
          <div className="text-sm text-gray-500 space-y-0.5 pt-1">
            {current.email && <p>✉ {current.email}</p>}
            {current.phone && <p>📞 {current.phone}</p>}
          </div>
        )}

        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Assignment'}
        </Button>
      </CardContent>
    </Card>
  )
}
