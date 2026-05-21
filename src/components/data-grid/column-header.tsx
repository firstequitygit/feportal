'use client'

import { useState } from 'react'
import { ArrowUp, ArrowDown, ChevronsUpDown, Filter } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FilterValue, SortState } from './use-grid-url-state'

export type ColumnFilterKind = 'contains' | 'range' | 'multi' | 'none'

export interface ColumnHeaderProps {
  id: string
  label: string
  sortable: boolean
  filterKind: ColumnFilterKind
  /** For multi-select filters: list of option values & labels. */
  options?: { label: string; value: string }[]
  sort: SortState
  filter: FilterValue | undefined
  onSort: (next: SortState) => void
  onFilter: (next: FilterValue | null) => void
}

export function ColumnHeader({
  id, label, sortable, filterKind, options,
  sort, filter, onSort, onFilter,
}: ColumnHeaderProps) {
  const [open, setOpen] = useState(false)

  function toggleSort() {
    if (!sortable) return
    if (!sort || sort.id !== id) onSort({ id, desc: false })
    else if (!sort.desc) onSort({ id, desc: true })
    else onSort(null)
  }

  const sortIcon = !sortable
    ? null
    : !sort || sort.id !== id
      ? <ChevronsUpDown className="w-3 h-3 text-gray-400" />
      : sort.desc
        ? <ArrowDown className="w-3 h-3 text-primary" />
        : <ArrowUp className="w-3 h-3 text-primary" />

  return (
    <div className="flex items-center justify-between gap-2 group">
      <button
        type="button"
        className={`flex items-center gap-1 text-xs font-medium text-gray-600 uppercase tracking-wide ${sortable ? 'hover:text-gray-900' : ''}`}
        onClick={toggleSort}
        disabled={!sortable}
      >
        <span>{label}</span>
        {sortIcon}
      </button>
      {filterKind !== 'none' && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className={`inline-flex items-center justify-center rounded-lg border border-transparent h-6 w-6 p-0 text-sm font-medium transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground ${filter ? 'text-primary' : 'text-gray-400 hover:text-gray-700'}`}
          >
            <Filter className="w-3 h-3" />
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <FilterEditor
              kind={filterKind}
              options={options}
              value={filter}
              onChange={(next) => { onFilter(next); if (next === null) setOpen(false) }}
              onClose={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function FilterEditor({
  kind, options, value, onChange, onClose,
}: {
  kind: ColumnFilterKind
  options?: { label: string; value: string }[]
  value: FilterValue | undefined
  onChange: (next: FilterValue | null) => void
  onClose: () => void
}) {
  if (kind === 'contains') {
    const v = value?.kind === 'contains' ? value.value : ''
    return (
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600">Contains</label>
        <Input
          autoFocus
          value={v}
          onChange={(e) => onChange(e.target.value ? { kind: 'contains', value: e.target.value } : null)}
          placeholder="Type to filter…"
        />
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); onClose() }}>Clear</Button>
        </div>
      </div>
    )
  }
  if (kind === 'range') {
    const min = value?.kind === 'range' ? (value.min ?? '') : ''
    const max = value?.kind === 'range' ? (value.max ?? '') : ''
    function commitRange(nextMin: string, nextMax: string) {
      const mn = nextMin === '' ? null : Number(nextMin)
      const mx = nextMax === '' ? null : Number(nextMax)
      if (mn === null && mx === null) onChange(null)
      else onChange({ kind: 'range', min: Number.isFinite(mn) ? mn as number : null, max: Number.isFinite(mx) ? mx as number : null })
    }
    return (
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600">Range</label>
        <div className="flex items-center gap-2">
          <Input type="number" placeholder="min" value={min} onChange={(e) => commitRange(e.target.value, String(max))} />
          <span className="text-gray-400">–</span>
          <Input type="number" placeholder="max" value={max} onChange={(e) => commitRange(String(min), e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); onClose() }}>Clear</Button>
        </div>
      </div>
    )
  }
  if (kind === 'multi') {
    const selected = value?.kind === 'multi' ? value.values : []
    function toggle(v: string) {
      const next = selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]
      onChange(next.length ? { kind: 'multi', values: next } : null)
    }
    return (
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600">Filter by</label>
        <div className="space-y-1">
          {(options ?? []).map(o => (
            <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); onClose() }}>Clear</Button>
        </div>
      </div>
    )
  }
  return null
}
