'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/searchable-select'
import { CollapsibleCard } from '@/components/collapsible-card'

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
    <CollapsibleCard title="Borrower Assignment">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Assign a borrower to give them portal access to this loan.
        </p>
        <SearchableSelect
          value={selected || null}
          onChange={(id) => setSelected(id ?? '')}
          options={allBorrowers.map(b => ({
            id: b.id,
            label: b.full_name || b.email,
            sublabel: b.email,
          }))}
          placeholder="Search borrowers…"
          emptyLabel="— Unassigned —"
        />
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Assignment'}
        </Button>
      </div>
    </CollapsibleCard>
  )
}
