'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/types'

function shortStage(s: PipelineStage | string): string {
  return s.split(' /')[0].trim()
}

interface Props {
  loanId: string
  currentStage: PipelineStage | null
}

export function EditableLoanStage({ loanId, currentStage }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(next: string) {
    if (!next || next === currentStage) return
    if (next === 'Closed' && !confirm('Mark this loan as Closed? This will send the borrower a "Loan Funded" email.')) {
      return
    }
    setSaving(true)
    setError(null)
    const res = await fetch('/api/loans/stage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, stage: next }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      router.refresh()
    } else {
      setError(data.error ?? 'Could not change stage')
    }
    setSaving(false)
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <select
        value={currentStage ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="text-sm font-semibold border border-gray-200 hover:border-gray-300 rounded-md px-2 py-1 bg-white cursor-pointer focus:outline-none focus:border-primary disabled:opacity-50"
        title="Change stage"
      >
        {!currentStage && <option value="">Unknown</option>}
        {PIPELINE_STAGES.map(s => (
          <option key={s} value={s}>{shortStage(s)}</option>
        ))}
      </select>
      {saving && <span className="text-xs text-gray-400">Saving…</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
