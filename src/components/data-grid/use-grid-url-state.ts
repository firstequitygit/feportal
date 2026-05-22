'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export type SortState = { id: string; desc: boolean } | null

/** A single filter entry. `kind` lets the column header pick the right input UI. */
export type FilterValue =
  | { kind: 'contains'; value: string }
  | { kind: 'range'; min: number | null; max: number | null }
  | { kind: 'multi'; values: string[] }

export type FilterMap = Record<string, FilterValue>

export interface GridUrlState {
  visibleCols: string[] | null  // null = use default
  sort: SortState
  filters: FilterMap
}

const FILTER_PREFIX = 'filter:'

// Each filter param is tagged with its kind ('c:'/'m:'/'r:') so the round-trip is
// unambiguous. Inferring kind from the value shape was lossy: a single-value multi
// (one selected option, no comma) was indistinguishable from a 'contains' filter,
// so a single facet selection never reflected back as checked.
function parseFilterParam(raw: string): FilterValue | null {
  if (raw.startsWith('c:')) {
    const value = raw.slice(2)
    return value ? { kind: 'contains', value } : null
  }
  if (raw.startsWith('m:')) {
    const body = raw.slice(2)
    const values = body ? body.split(',').map(decodeURIComponent).filter(Boolean) : []
    return values.length ? { kind: 'multi', values } : null
  }
  if (raw.startsWith('r:')) {
    const [a, b] = raw.slice(2).split('..')
    const min = a === '' ? null : Number(a)
    const max = b === '' ? null : Number(b)
    if (min === null && max === null) return null
    return { kind: 'range', min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null }
  }
  // Unknown / legacy format — treat as a plain contains so we never crash.
  return raw ? { kind: 'contains', value: raw } : null
}

function serializeFilter(f: FilterValue): string {
  if (f.kind === 'contains') return `c:${f.value}`
  // Encode each value so commas inside a value (e.g. "Acme, Inc.") don't break the split.
  if (f.kind === 'multi') return `m:${f.values.map(encodeURIComponent).join(',')}`
  return `r:${f.min ?? ''}..${f.max ?? ''}`
}

export function useGridUrlState(defaultVisible: string[]): {
  state: GridUrlState
  setVisibleCols: (cols: string[]) => void
  setSort: (sort: SortState) => void
  setFilter: (colId: string, filter: FilterValue | null) => void
  clearAllFilters: () => void
} {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const state: GridUrlState = useMemo(() => {
    const colsParam = params.get('cols')
    const visibleCols = colsParam ? colsParam.split(',').filter(Boolean) : null

    const sortParam = params.get('sort')
    let sort: SortState = null
    if (sortParam) {
      const [id, dir] = sortParam.split(':')
      if (id) sort = { id, desc: dir === 'desc' }
    }

    const filters: FilterMap = {}
    for (const [key, value] of params.entries()) {
      if (key.startsWith(FILTER_PREFIX)) {
        const colId = key.slice(FILTER_PREFIX.length)
        const parsed = parseFilterParam(value)
        if (parsed) filters[colId] = parsed
      }
    }

    return { visibleCols, sort, filters }
  }, [params])

  const push = useCallback((next: URLSearchParams) => {
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname])

  const setVisibleCols = useCallback((cols: string[]) => {
    const next = new URLSearchParams(params.toString())
    // If the user's selection equals the default exactly, drop the param.
    const isDefault = cols.length === defaultVisible.length && cols.every(c => defaultVisible.includes(c))
    if (isDefault) next.delete('cols')
    else next.set('cols', cols.join(','))
    push(next)
  }, [params, push, defaultVisible])

  const setSort = useCallback((sort: SortState) => {
    const next = new URLSearchParams(params.toString())
    if (!sort) next.delete('sort')
    else next.set('sort', `${sort.id}:${sort.desc ? 'desc' : 'asc'}`)
    push(next)
  }, [params, push])

  const setFilter = useCallback((colId: string, filter: FilterValue | null) => {
    const next = new URLSearchParams(params.toString())
    const key = `${FILTER_PREFIX}${colId}`
    if (filter === null) next.delete(key)
    else next.set(key, serializeFilter(filter))
    push(next)
  }, [params, push])

  const clearAllFilters = useCallback(() => {
    const next = new URLSearchParams(params.toString())
    for (const key of Array.from(next.keys())) {
      if (key.startsWith(FILTER_PREFIX)) next.delete(key)
    }
    push(next)
  }, [params, push])

  return { state, setVisibleCols, setSort, setFilter, clearAllFilters }
}
