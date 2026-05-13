'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { type LoanProcessor } from '@/lib/types'

interface Props {
  loanId: string
  currentLoanProcessorId: string | null    // slot 1
  currentLoanProcessorId2: string | null   // slot 2
  allLoanProcessors: LoanProcessor[]
}

export function AdminLoanProcessorAssign({
  loanId,
  currentLoanProcessorId,
  currentLoanProcessorId2,
  allLoanProcessors,
}: Props) {
  const [slot1, setSlot1] = useState(currentLoanProcessorId ?? '')
  const [slot2, setSlot2] = useState(currentLoanProcessorId2 ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (slot1 && slot2 && slot1 === slot2) {
      toast.error('The two loan processor slots must be different')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/assign-loan-processor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanId,
          loanProcessorId: slot1 || null,
          loanProcessorId2: slot2 || null,
        }),
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

  const lp1 = allLoanProcessors.find(lp => lp.id === slot1)
  const lp2 = allLoanProcessors.find(lp => lp.id === slot2)

  function renderSelect(label: string, value: string, onChange: (v: string) => void, excludeId: string) {
    const lp = allLoanProcessors.find(p => p.id === value)
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— Unassigned —</option>
          {allLoanProcessors
            .filter(p => p.id !== excludeId || p.id === value)
            .map(p => (
              <option key={p.id} value={p.id}>
                {p.full_name}{p.title ? ` — ${p.title}` : ''}
              </option>
            ))}
        </select>
        {lp && (
          <div className="text-xs text-gray-500 space-y-0.5 pl-1">
            {lp.email && <p>✉ {lp.email}</p>}
            {lp.phone && <p>📞 {lp.phone}</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Loan Processors</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderSelect('Primary LP', slot1, setSlot1, slot2)}
        {renderSelect('Secondary LP', slot2, setSlot2, slot1)}
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Assignment'}
        </Button>
        {/* visual reference to suppress unused-variable warnings */}
        <span className="hidden">{lp1?.id}{lp2?.id}</span>
      </CardContent>
    </Card>
  )
}
