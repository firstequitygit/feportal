'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/searchable-select'
import { CollapsibleCard } from '@/components/collapsible-card'

interface BorrowerOption {
  id: string
  full_name: string
  email: string
}

interface Props {
  loanId: string
  /** Current values in each co-borrower slot (2/3/4), each may be null. */
  currentSlots: { slot2: string | null; slot3: string | null; slot4: string | null }
  allBorrowers: BorrowerOption[]
  /** The primary borrower's id, used to disable it in the co-borrower dropdowns. */
  primaryBorrowerId: string | null
}

const SLOT_LABELS = ['Co-borrower #1', 'Co-borrower #2', 'Co-borrower #3']

export function CoBorrowersAssign({ loanId, currentSlots, allBorrowers, primaryBorrowerId }: Props) {
  const [slots, setSlots] = useState<(string | null)[]>([
    currentSlots.slot2, currentSlots.slot3, currentSlots.slot4,
  ])
  const [savingSlot, setSavingSlot] = useState<number | null>(null)

  async function saveSlot(slotIndex: number, borrowerId: string | null) {
    const slotNumber = slotIndex + 2  // index 0 → slot 2
    setSavingSlot(slotIndex)
    try {
      const res = await fetch('/api/loans/assign-borrower', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, borrowerId, slot: slotNumber }),
      })
      const data = await res.json()
      if (data.success) {
        setSlots(prev => {
          const next = [...prev]
          next[slotIndex] = borrowerId
          return next
        })
        toast.success(`${SLOT_LABELS[slotIndex]} saved`)
      } else {
        toast.error(data.error ?? 'Failed to save')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSavingSlot(null)
    }
  }

  function selectableBorrowersFor(slotIndex: number): BorrowerOption[] {
    // Exclude the primary borrower + anyone already in another co-borrower slot
    const inUse = new Set<string>()
    if (primaryBorrowerId) inUse.add(primaryBorrowerId)
    slots.forEach((id, i) => { if (id && i !== slotIndex) inUse.add(id) })
    return allBorrowers.filter(b => !inUse.has(b.id) || b.id === slots[slotIndex])
  }

  return (
    <CollapsibleCard title="Co-Borrowers">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Up to 3 additional borrowers can be assigned to a loan. Each gets their own portal
          login and receives the same notifications as the primary borrower.
        </p>
        {[0, 1, 2].map(slotIndex => {
          const selected = slots[slotIndex]
          const options = selectableBorrowersFor(slotIndex)
          return (
            <div key={slotIndex} className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">{SLOT_LABELS[slotIndex]}</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <SearchableSelect
                    value={selected}
                    onChange={(id) => saveSlot(slotIndex, id)}
                    options={options.map(b => ({
                      id: b.id,
                      label: b.full_name || b.email,
                      sublabel: b.email,
                    }))}
                    placeholder="Search borrowers…"
                    emptyLabel="— None —"
                    disabled={savingSlot !== null}
                  />
                </div>
                {savingSlot === slotIndex && (
                  <Button size="sm" variant="outline" disabled>Saving…</Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </CollapsibleCard>
  )
}
