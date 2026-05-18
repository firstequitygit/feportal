'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface BrokerOption {
  id: string
  full_name: string | null
  email: string
  company_name: string | null
}

interface Props {
  loanId: string
  currentBrokerId: string | null
  /** Optional second broker slot — the broker's processor or a co-broker. */
  currentBrokerId2?: string | null
  allBrokers: BrokerOption[]
}

const SLOT_LABELS = ['Primary Broker', 'Co-Broker / Broker Processor']

export function BrokerAssign({ loanId, currentBrokerId, currentBrokerId2 = null, allBrokers }: Props) {
  const [slots, setSlots] = useState<(string | null)[]>([currentBrokerId, currentBrokerId2])
  const [savingSlot, setSavingSlot] = useState<number | null>(null)

  async function saveSlot(slotIndex: number, brokerId: string | null) {
    const slotNumber = slotIndex + 1
    setSavingSlot(slotIndex)
    try {
      const res = await fetch('/api/loans/assign-broker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, brokerId, slot: slotNumber }),
      })
      const data = await res.json()
      if (data.success) {
        setSlots(prev => {
          const next = [...prev]
          next[slotIndex] = brokerId
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

  function selectableBrokersFor(slotIndex: number): BrokerOption[] {
    // Exclude any broker already in the other slot
    const other = slots[1 - slotIndex]
    return allBrokers.filter(b => !other || b.id === slots[slotIndex] || b.id !== other)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Broker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-500">
          When a broker is assigned, the broker is the portal contact and all notifications go to
          them instead of the borrower. A second slot is available for the broker&apos;s processor
          or a co-broker — both get logins and emails.
        </p>

        {[0, 1].map(slotIndex => {
          const selected = slots[slotIndex] ?? ''
          const options = selectableBrokersFor(slotIndex)
          return (
            <div key={slotIndex} className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">{SLOT_LABELS[slotIndex]}</label>
              <div className="flex gap-2">
                <select
                  value={selected}
                  onChange={(e) => saveSlot(slotIndex, e.target.value || null)}
                  disabled={savingSlot !== null}
                  className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  <option value="">— {slotIndex === 0 ? 'No broker (direct to borrower)' : 'None'} —</option>
                  {options.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.full_name ?? b.email}{b.company_name ? ` · ${b.company_name}` : ''} ({b.email})
                    </option>
                  ))}
                </select>
                {savingSlot === slotIndex && (
                  <Button size="sm" variant="outline" disabled>Saving…</Button>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
