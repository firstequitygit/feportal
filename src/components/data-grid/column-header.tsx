'use client'

import { useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, ChevronsUpDown, Filter } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FilterValue, SortState } from './use-grid-url-state'

export type ColumnFilterKind = 'contains' | 'range' | 'multi' | 'facet' | 'none'

export interface ColumnHeaderProps {
  id: string
  label: string
  sortable: boolean
  filterKind: ColumnFilterKind
  /** For 'multi' filters: explicit list of option values & labels. */
  options?: { label: string; value: string }[]
  /** For 'facet' filters: distinct values derived from the column's data. */
  facetOptions?: string[]
  sort: SortState
  filter: FilterValue | undefined
  onSort: (next: SortState) => void
  onFilter: (next: FilterValue | null) => void
}

export function ColumnHeader({
  id, label, sortable, filterKind, options, facetOptions,
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
        className={`flex items-center gap-1 text-xs font-medium text-gray-600 uppercase tracking-wide truncate ${sortable ? 'hover:text-gray-900' : ''}`}
        onClick={toggleSort}
        disabled={!sortable}
      >
        <span className="truncate">{label}</span>
        {sortIcon}
      </button>
      {filterKind !== 'none' && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className={`inline-flex items-center justify-center rounded-lg border border-transparent h-6 w-6 p-0 shrink-0 text-sm font-medium transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground ${filter ? 'text-primary' : 'text-gray-400 hover:text-gray-700'}`}
          >
            <Filter className="w-3 h-3" />
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <FilterEditor
              kind={filterKind}
              options={options}
              facetOptions={facetOptions}
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
  kind, options, facetOptions, value, onChange, onClose,
}: {
  kind: ColumnFilterKind
  options?: { label: string; value: string }[]
  facetOptions?: string[]
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
  if (kind === 'facet') {
    return (
      <FacetFilter
        allOptions={facetOptions ?? []}
        value={value}
        onChange={onChange}
        onClose={onClose}
      />
    )
  }
  return null
}

/** Excel-style filter: a search box over a scrollable, multi-select checklist. */
function FacetFilter({
  allOptions, value, onChange, onClose,
}: {
  allOptions: string[]
  value: FilterValue | undefined
  onChange: (next: FilterValue | null) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const selected = value?.kind === 'multi' ? value.values : []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allOptions
    return allOptions.filter(o => o.toLowerCase().includes(q))
  }, [allOptions, search])

  function commit(next: string[]) {
    onChange(next.length ? { kind: 'multi', values: next } : null)
  }
  function toggle(v: string) {
    commit(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  }
  // "Select all" operates over the currently-visible (search-filtered) options.
  const allVisibleSelected = filtered.length > 0 && filtered.every(o => selected.includes(o))
  function toggleAllVisible() {
    if (allVisibleSelected) commit(selected.filter(s => !filtered.includes(s)))
    else commit([...new Set([...selected, ...filtered])])
  }

  return (
    <div className="space-y-2">
      <Input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search…"
        className="h-8"
      />
      <label className="flex items-center gap-2 text-sm cursor-pointer border-b border-gray-100 pb-1.5">
        <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
        <span className="text-gray-600">{search ? 'Select all matches' : 'Select all'}</span>
      </label>
      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No matches.</p>
        ) : filtered.map(o => (
          <label key={o} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
            <span className="truncate">{o}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 pt-1.5">
        <span className="text-xs text-gray-400">{selected.length} selected</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); setSearch(''); onClose() }}>Clear</Button>
      </div>
    </div>
  )
}
