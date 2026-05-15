'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'

interface Props {
  from: string  // YYYY-MM-DD
  to: string    // YYYY-MM-DD
  /** Quick-pick shortcuts shown above the inputs. */
  presets?: Array<{ label: string; from: string; to: string }>
}

export function DateRangeFilter({ from, to, presets }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)

  function applyRange(f: string, t: string) {
    const params = new URLSearchParams({ from: f, to: t })
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-3 mb-6">
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">From</label>
        <input
          type="date"
          value={draftFrom}
          onChange={e => setDraftFrom(e.target.value)}
          className="text-sm border border-gray-200 rounded px-2 py-1.5"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">To</label>
        <input
          type="date"
          value={draftTo}
          onChange={e => setDraftTo(e.target.value)}
          className="text-sm border border-gray-200 rounded px-2 py-1.5"
        />
      </div>
      <button
        onClick={() => applyRange(draftFrom, draftTo)}
        className="text-xs font-medium bg-primary text-white px-3 py-2 rounded-md hover:opacity-90"
      >
        Apply
      </button>
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 ml-2">
          {presets.map(p => (
            <button
              key={p.label}
              onClick={() => { setDraftFrom(p.from); setDraftTo(p.to); applyRange(p.from, p.to) }}
              className="text-xs text-gray-600 hover:text-primary px-2 py-1 border border-gray-200 rounded-md hover:border-primary/40"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
