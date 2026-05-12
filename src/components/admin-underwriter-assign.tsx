'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { type Underwriter } from '@/lib/types'

interface Props {
  loanId: string
  currentUnderwriterId: string | null
  allUnderwriters: Underwriter[]
}

export function AdminUnderwriterAssign({ loanId, currentUnderwriterId, allUnderwriters }: Props) {
  const [selected, setSelected] = useState(currentUnderwriterId ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/assign-underwriter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, underwriterId: selected || null }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Underwriter assignment saved')
      } else {
        toast.error(data.error ?? 'Failed to save assignment')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const current = allUnderwriters.find(uw => uw.id === selected)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Underwriter</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— Unassigned —</option>
          {allUnderwriters.map(uw => (
            <option key={uw.id} value={uw.id}>
              {uw.full_name}{uw.title ? ` — ${uw.title}` : ''}
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
