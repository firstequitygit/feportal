'use client'

import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ColumnHeader, type ColumnFilterKind } from './column-header'
import { ColumnVisibilityMenu, type ColumnDef as VisibilityColDef } from './column-visibility-menu'
import { FilterBar } from './filter-bar'
import { useGridUrlState, type FilterValue } from './use-grid-url-state'

export interface DataGridColumn<TRow> {
  id: string
  label: string
  /** Whether this column is sortable. Default: true. */
  sortable?: boolean
  /** Filter UI kind. 'none' = no filter affordance. Default: 'none'. */
  filterKind?: ColumnFilterKind
  /** For multi-select filter: the options. */
  filterOptions?: { label: string; value: string }[]
  /** Always visible (excluded from the visibility menu's toggleable set). */
  alwaysVisible?: boolean
  /** Accessor — must return a primitive used for sort + filter. */
  accessor: (row: TRow) => string | number | null
  /** Cell renderer. Receives the row. */
  cell: (row: TRow) => React.ReactNode
  /** Width hint in Tailwind class (e.g. 'w-48'). Optional. */
  width?: string
}

export interface DataGridProps<TRow extends { id: string }> {
  rows: TRow[]
  columns: DataGridColumn<TRow>[]
  defaultVisibleColumns: string[]
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
  rows, columns, defaultVisibleColumns, rowHref, emptyState,
}: DataGridProps<TRow>) {
  const { state, setVisibleCols, setSort, setFilter, clearAllFilters } = useGridUrlState(defaultVisibleColumns)

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
      <Table>
        <TableHeader>
          <TableRow>
            {visibleColumnDefs.map(c => (
              <TableHead key={c.id} className={c.width}>
                <ColumnHeader
                  id={c.id}
                  label={c.label}
                  sortable={c.sortable !== false}
                  filterKind={c.filterKind ?? 'none'}
                  options={c.filterOptions}
                  sort={state.sort}
                  filter={state.filters[c.id]}
                  onSort={setSort}
                  onFilter={(f) => setFilter(c.id, f)}
                />
              </TableHead>
            ))}
            {rowHref && <TableHead className="w-10" aria-label="Open" />}
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
                <TableCell key={c.id} className={c.width}>
                  {c.cell(row)}
                </TableCell>
              ))}
              {rowHref && (
                <TableCell className="w-10 text-right">
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
  )
}
