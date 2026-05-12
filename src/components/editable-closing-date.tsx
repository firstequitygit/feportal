'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  loanId: string
  currentDate: string | null
}

function formatDisplay(val: string | null): string {
  if (!val) return '—'
  // Date column comes back as 'YYYY-MM-DD'; parse without timezone shift
  const [y, m, d] = val.split('T')[0].split('-').map(Number)
  if (!y || !m || !d) return val
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function EditableClosingDate({ loanId, currentDate }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentDate?.split('T')[0] ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/loans/closing-date', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, estimatedClosingDate: value || null }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      setEditing(false)
      router.refresh()
    } else {
      setError(data.error ?? 'Could not save')
    }
    setSaving(false)
  }

  function handleCancel() {
    setValue(currentDate?.split('T')[0] ?? '')
    setEditing(false)
    setError(null)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <input
          type="date"
          value={value}
          onChange={e => setValue(e.target.value)}
          className="text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:border-primary"
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs text-white bg-primary hover:opacity-90 disabled:opacity-50 px-2 py-1 rounded font-medium"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          disabled={saving}
          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <p className="text-xs text-red-600 w-full text-right">{error}</p>}
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="font-medium text-gray-900 hover:text-primary transition-colors"
      title="Click to edit"
    >
      {formatDisplay(currentDate)}
      <span className="text-xs text-gray-400 ml-1.5">edit</span>
    </button>
  )
}
