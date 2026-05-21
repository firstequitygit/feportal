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

function parseFilterParam(raw: string): FilterValue {
  // range: "min..max" (either side may be empty)
  if (raw.includes('..')) {
    const [a, b] = raw.split('..')
    const min = a === '' ? null : Number(a)
    const max = b === '' ? null : Number(b)
    return { kind: 'range', min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null }
  }
  // multi: "a,b,c"
  if (raw.includes(',')) return { kind: 'multi', values: raw.split(',').filter(Boolean) }
  // contains: plain string
  return { kind: 'contains', value: raw }
}

function serializeFilter(f: FilterValue): string {
  if (f.kind === 'contains') return f.value
  if (f.kind === 'multi') return f.values.join(',')
  // range
  return `${f.min ?? ''}..${f.max ?? ''}`
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
        filters[colId] = parseFilterParam(value)
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
