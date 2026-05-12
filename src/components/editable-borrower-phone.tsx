'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  loanId: string
  currentPhone: string | null
}

export function EditableBorrowerPhone({ loanId, currentPhone }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentPhone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/loans/borrower-phone', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, phone: value.trim() || null }),
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
    setValue(currentPhone ?? '')
    setEditing(false)
    setError(null)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <input
          type="tel"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="(555) 555-5555"
          className="text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:border-primary w-40"
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
      {currentPhone ?? '—'}
      <span className="text-xs text-gray-400 ml-1.5">edit</span>
    </button>
  )
}
