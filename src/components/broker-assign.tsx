'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/searchable-select'
import { CollapsibleCard } from '@/components/collapsible-card'

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
    <CollapsibleCard title="Broker">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          When a broker is assigned, the broker is the portal contact and all notifications go to
          them instead of the borrower. A second slot is available for the broker&apos;s processor
          or a co-broker — both get logins and emails.
        </p>

        {[0, 1].map(slotIndex => {
          const selected = slots[slotIndex]
          const options = selectableBrokersFor(slotIndex)
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
                      label: (b.full_name || b.email) + (b.company_name ? ` · ${b.company_name}` : ''),
                      sublabel: b.email,
                    }))}
                    placeholder="Search brokers…"
                    emptyLabel={slotIndex === 0 ? '— No broker (direct to borrower) —' : '— None —'}
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
