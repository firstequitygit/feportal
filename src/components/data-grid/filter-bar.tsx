'use client'

import { X } from 'lucide-react'
import type { FilterMap, FilterValue } from './use-grid-url-state'

export interface FilterBarProps {
  filters: FilterMap
  columnLabels: Record<string, string>
  onClearOne: (colId: string) => void
  onClearAll: () => void
}

function formatFilter(f: FilterValue): string {
  if (f.kind === 'contains') return `contains "${f.value}"`
  if (f.kind === 'multi') return f.values.join(', ')
  // range
  const min = f.min ?? '…'
  const max = f.max ?? '…'
  return `${min}–${max}`
}

export function FilterBar({ filters, columnLabels, onClearOne, onClearAll }: FilterBarProps) {
  const entries = Object.entries(filters)
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs">
      <span className="text-gray-500">Filters:</span>
      {entries.map(([colId, f]) => (
        <span key={colId} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white border border-gray-200">
          <span className="font-medium text-gray-700">{columnLabels[colId] ?? colId}</span>
          <span className="text-gray-500">{formatFilter(f)}</span>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-700"
            onClick={() => onClearOne(colId)}
            aria-label={`Clear ${columnLabels[colId] ?? colId} filter`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <button type="button" className="text-gray-500 hover:text-gray-900 underline" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  )
}
