'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ColumnHeader, type ColumnFilterKind } from './column-header'
import { ColumnVisibilityMenu, type ColumnDef as VisibilityColDef } from './column-visibility-menu'
import { FilterBar } from './filter-bar'
import { useGridUrlState, type FilterValue } from './use-grid-url-state'

const DEFAULT_WIDTH = 160
const DEFAULT_MIN_WIDTH = 80
const CHEVRON_WIDTH = 44

export interface DataGridColumn<TRow> {
  id: string
  label: string
  /** Whether this column is sortable. Default: true. */
  sortable?: boolean
  /** Filter UI kind. 'none' = no filter affordance. Default: 'none'. */
  filterKind?: ColumnFilterKind
  /** For 'multi' filter: explicit options. */
  filterOptions?: { label: string; value: string }[]
  /** For 'facet' filter on multi-valued cells: the values this row contributes.
   *  If omitted, the facet derives a single value from accessor(). */
  facetAccessor?: (row: TRow) => string[]
  /** Always visible (excluded from the visibility menu's toggleable set). */
  alwaysVisible?: boolean
  /** Accessor — must return a primitive used for sort + filter. */
  accessor: (row: TRow) => string | number | null
  /** Cell renderer. Receives the row. */
  cell: (row: TRow) => React.ReactNode
  /** Default column width in px. Resizable; persisted to localStorage. */
  width?: number
  /** Minimum width in px when resizing. Default 80. */
  minWidth?: number
}

export interface DataGridProps<TRow extends { id: string }> {
  rows: TRow[]
  columns: DataGridColumn<TRow>[]
  defaultVisibleColumns: string[]
  /** Unique key for persisting column widths in localStorage. */
  storageKey: string
  /** Where the chevron-navigate goes. If null/undefined, no chevron is rendered. */
  rowHref?: (row: TRow) => string | null
  emptyState?: React.ReactNode
}

function matchesFilter(value: string | number | null, f: FilterValue): boolean {
  if (value === null || value === undefined) return false
  if (f.kind === 'contains') {
    return String(value).toLowerCase().includes(f.value.toLowerCase())
  }
  if (f.kind === 'multi') {
    return f.values.includes(String(value))
  }
  // range
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return false
  if (f.min !== null && n < f.min) return false
  if (f.max !== null && n > f.max) return false
  return true
}

export function DataGrid<TRow extends { id: string }>({
  rows, columns, defaultVisibleColumns, storageKey, rowHref, emptyState,
}: DataGridProps<TRow>) {
  const { state, setVisibleCols, setSort, setFilter, clearAllFilters } = useGridUrlState(defaultVisibleColumns)

  // --- Column widths (resizable, persisted to localStorage after mount) ---
  const defaultWidths = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of columns) m[c.id] = c.width ?? DEFAULT_WIDTH
    return m
  }, [columns])
  const [widths, setWidths] = useState<Record<string, number>>(defaultWidths)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`dg:width:${storageKey}`)
      if (saved) setWidths(prev => ({ ...prev, ...JSON.parse(saved) as Record<string, number> }))
    } catch { /* ignore corrupt storage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const widthFor = (id: string) => widths[id] ?? defaultWidths[id] ?? DEFAULT_WIDTH

  const resizing = useRef(false)
  function startResize(e: React.PointerEvent, colId: string) {
    e.preventDefault()
    e.stopPropagation()
    resizing.current = true
    const startX = e.clientX
    const startW = widthFor(colId)
    const col = columns.find(c => c.id === colId)
    const minW = col?.minWidth ?? DEFAULT_MIN_WIDTH
    function onMove(ev: PointerEvent) {
      const next = Math.max(minW, startW + (ev.clientX - startX))
      setWidths(prev => ({ ...prev, [colId]: next }))
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setWidths(prev => {
        try { localStorage.setItem(`dg:width:${storageKey}`, JSON.stringify(prev)) } catch { /* ignore */ }
        return prev
      })
      // Let the click that ends the drag settle before re-enabling header clicks.
      setTimeout(() => { resizing.current = false }, 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // --- Faceted filter options (distinct values derived from data) ---
  const facetOptionsByCol = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const c of columns) {
      if (c.filterKind !== 'facet') continue
      const set = new Set<string>()
      for (const row of rows) {
        const vals = c.facetAccessor ? c.facetAccessor(row) : [c.accessor(row)]
        for (const v of vals) {
          if (v !== null && v !== undefined && String(v).trim() !== '') set.add(String(v))
        }
      }
      m[c.id] = [...set].sort((a, b) => a.localeCompare(b))
    }
    return m
  }, [columns, rows])

  const visible = useMemo(() => {
    const ids = state.visibleCols ?? defaultVisibleColumns
    const set = new Set(ids)
    for (const c of columns) if (c.alwaysVisible) set.add(c.id)
    return set
  }, [state.visibleCols, defaultVisibleColumns, columns])

  // Apply filters
  const filteredRows = useMemo(() => {
    const filterEntries = Object.entries(state.filters)
    if (filterEntries.length === 0) return rows
    return rows.filter(row => {
      for (const [colId, f] of filterEntries) {
        const col = columns.find(c => c.id === colId)
        if (!col) continue
        // Multi-valued facet: row matches if any of its values is selected.
        if (f.kind === 'multi' && col.facetAccessor) {
          const vals = col.facetAccessor(row)
          if (!vals.some(v => f.values.includes(v))) return false
          continue
        }
        if (!matchesFilter(col.accessor(row), f)) return false
      }
      return true
    })
  }, [rows, columns, state.filters])

  // Apply sort
  const sortedRows = useMemo(() => {
    if (!state.sort) return filteredRows
    const col = columns.find(c => c.id === state.sort!.id)
    if (!col) return filteredRows
    const dir = state.sort.desc ? -1 : 1
    return [...filteredRows].sort((a, b) => {
      const av = col.accessor(a)
      const bv = col.accessor(b)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [filteredRows, columns, state.sort])

  const visibleColumnDefs = columns.filter(c => visible.has(c.id))
  const columnLabels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of columns) m[c.id] = c.label
    return m
  }, [columns])

  const visibilityCols: VisibilityColDef[] = columns.map(c => ({
    id: c.id, label: c.label, alwaysVisible: c.alwaysVisible,
  }))

  const totalWidth = visibleColumnDefs.reduce((sum, c) => sum + widthFor(c.id), 0) + (rowHref ? CHEVRON_WIDTH : 0)

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <p className="text-sm text-gray-500">{sortedRows.length} {sortedRows.length === 1 ? 'row' : 'rows'}</p>
        <ColumnVisibilityMenu
          columns={visibilityCols}
          visible={visible}
          defaults={defaultVisibleColumns}
          onChange={setVisibleCols}
        />
      </div>
      <FilterBar
        filters={state.filters}
        columnLabels={columnLabels}
        onClearOne={(id) => setFilter(id, null)}
        onClearAll={clearAllFilters}
      />
      <div className="overflow-x-auto">
        <Table style={{ tableLayout: 'fixed', width: totalWidth }}>
          <colgroup>
            {visibleColumnDefs.map(c => <col key={c.id} style={{ width: widthFor(c.id) }} />)}
            {rowHref && <col style={{ width: CHEVRON_WIDTH }} />}
          </colgroup>
          <TableHeader>
            <TableRow>
              {visibleColumnDefs.map(c => (
                <TableHead key={c.id} className="relative">
                  <ColumnHeader
                    id={c.id}
                    label={c.label}
                    sortable={c.sortable !== false && !resizing.current}
                    filterKind={c.filterKind ?? 'none'}
                    options={c.filterOptions}
                    facetOptions={facetOptionsByCol[c.id]}
                    sort={state.sort}
                    filter={state.filters[c.id]}
                    onSort={setSort}
                    onFilter={(f) => setFilter(c.id, f)}
                  />
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={(e) => startResize(e, c.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-primary/40 active:bg-primary/60"
                  />
                </TableHead>
              ))}
              {rowHref && <TableHead aria-label="Open" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnDefs.length + (rowHref ? 1 : 0)}>
                  <div className="py-12 text-center text-sm text-gray-400">
                    {emptyState ?? 'No rows.'}
                  </div>
                </TableCell>
              </TableRow>
            ) : sortedRows.map(row => (
              <TableRow key={row.id}>
                {visibleColumnDefs.map(c => (
                  <TableCell key={c.id} className="truncate">
                    {c.cell(row)}
                  </TableCell>
                ))}
                {rowHref && (
                  <TableCell className="text-right">
                    {(() => {
                      const href = rowHref(row)
                      if (!href) return null
                      return (
                        <a
                          href={href}
                          className="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded"
                          aria-label="Open"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </a>
                      )
                    })()}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
