# CRM Data Grid Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace card-based contact lists across five admin/LO surfaces (`/admin/borrowers`, `/admin/brokers`, `/loan-officer/borrowers`, `/loan-officer/brokers`, `/loan-officer/vendors`) with a shared CRM-style `<DataGrid>` primitive that supports per-column sort, per-column filter, show/hide columns, click-to-edit cells, URL-persisted state, and chevron-to-navigate.

**Architecture:** One generic `<DataGrid<TRow>>` client component sits in `src/components/data-grid/`, built on `@tanstack/react-table` + existing shadcn `<Table>` primitives. Each surface keeps its Server Component fetcher (and auth gate) untouched, then passes typed rows to the grid. State (visibility/sort/filters) lives in URL query params. Vendors stays derived from `loan_details` in v1.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · `@tanstack/react-table` (new) · shadcn/ui · Tailwind v4 · Supabase · Sonner (toasts). No automated tests — `npm run build` and manual Playwright sweeps are the correctness gates.

**Spec:** [`docs/superpowers/specs/2026-05-21-crm-data-grid-refactor-design.md`](../specs/2026-05-21-crm-data-grid-refactor-design.md) (commit `7f398bf`).

---

## Pre-flight: required reading before Task 1

Anyone executing this plan should skim these three files first so the patterns are familiar. Don't edit them.

- [`src/app/admin/borrowers/page.tsx`](../../../src/app/admin/borrowers/page.tsx) — current admin contact page (Server Component pattern: auth gate → `createAdminClient()` → fetch → pass rows to client component).
- [`src/app/api/loan-officer/borrowers/route.ts`](../../../src/app/api/loan-officer/borrowers/route.ts) — PATCH pattern, including the **"email cannot change if `auth_user_id` is set"** guard (line ~50–60). This guard MUST be preserved in any new PATCH endpoint.
- [`src/components/portal-shell.tsx`](../../../src/components/portal-shell.tsx) — sidebar layout wrapper; do not modify in this plan unless a task says so explicitly.

---

## Task 0: Merge origin/main into feature/loan-application-intake

The branch was cut before LO Borrowers/Brokers/Vendors routes landed on `main`. Bring them in.

**Files:**
- No new files; this is a git operation.

- [ ] **Step 0.1: Fetch latest origin**

```bash
cd c:/Users/apalm/FE-Portal/feportal
git fetch origin main
```

Expected: fetch completes without error.

- [ ] **Step 0.2: Confirm working tree state**

```bash
git status
```

Expected: lists the modified `auth/*` files and untracked apply step files already known. Note them — they should survive the merge untouched.

- [ ] **Step 0.3: Merge origin/main**

```bash
git merge origin/main --no-ff -m "merge: bring main into feature/loan-application-intake for grid refactor"
```

If conflicts arise, **stop**. Report each conflicting file to the user with the conflict markers. Do not auto-resolve.

If no conflicts: merge completes with a merge commit.

- [ ] **Step 0.4: Verify expected files now exist**

```bash
ls src/app/loan-officer/borrowers/page.tsx src/app/loan-officer/brokers/page.tsx src/app/loan-officer/vendors/page.tsx
```

Expected: all three files exist.

- [ ] **Step 0.5: Run build to confirm post-merge state compiles**

```bash
npm run build
```

Expected: build succeeds. If it fails, fix forward — do not revert the merge.

---

## Task 1: Install @tanstack/react-table

**Files:**
- Modify: `package.json`

- [ ] **Step 1.1: Install dependency**

```bash
npm install @tanstack/react-table@^8.20.0
```

Expected: package.json picks up `"@tanstack/react-table": "^8.20.0"`. No peer dep warnings (it depends on React 18+ which we already have via React 19).

- [ ] **Step 1.2: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 1.3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @tanstack/react-table for new data grid"
```

---

## Task 2: URL-state hook

A standalone hook with no React-Table coupling — it just reads/writes URL params. Building it first makes the DataGrid easier to wire up later.

**Files:**
- Create: `src/components/data-grid/use-grid-url-state.ts`

- [ ] **Step 2.1: Create the directory**

```bash
mkdir -p src/components/data-grid
```

- [ ] **Step 2.2: Write the hook**

Create `src/components/data-grid/use-grid-url-state.ts` with the following content:

```typescript
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
```

- [ ] **Step 2.3: Run build**

```bash
npm run build
```

Expected: build succeeds. The hook is not yet used anywhere, but it should type-check.

- [ ] **Step 2.4: Commit**

```bash
git add src/components/data-grid/use-grid-url-state.ts
git commit -m "feat(data-grid): URL-state hook for visibility/sort/filters"
```

---

## Task 3: EditableCell primitive

Click-to-edit cell. Stateless about column metadata — the consumer passes `value`, `onSave`, and `type`.

**Files:**
- Create: `src/components/data-grid/editable-cell.tsx`

- [ ] **Step 3.1: Write the component**

Create `src/components/data-grid/editable-cell.tsx`:

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export type EditableCellType = 'text' | 'email' | 'phone' | 'select'

export interface SelectOption { label: string; value: string }

export interface EditableCellProps {
  value: string | null
  type: EditableCellType
  /** Required for type='select'. */
  options?: SelectOption[]
  /** Placeholder displayed when value is null/empty. */
  placeholder?: string
  /** Display formatter for read state. Defaults to identity. */
  format?: (v: string | null) => string
  /** Async save. Throw or return a non-true value to indicate failure. */
  onSave: (next: string | null) => Promise<true | { error: string }>
  /** Optional: prevents edit (e.g. business rule says this field is locked). */
  readOnly?: boolean
}

export function EditableCell({
  value,
  type,
  options,
  placeholder = '—',
  format,
  onSave,
  readOnly = false,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(value ?? '')
  const [saving, setSaving] = useState(false)
  const [localValue, setLocalValue] = useState<string | null>(value)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  // Sync localValue when the row's source value changes (e.g. parent reload)
  useEffect(() => { setLocalValue(value); setDraft(value ?? '') }, [value])

  // Auto-focus + select on enter
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select()
    }
  }, [editing])

  async function commit() {
    const next = draft.trim() === '' ? null : draft.trim()
    if (next === (localValue ?? null)) { setEditing(false); return }
    setSaving(true)
    setLocalValue(next)        // optimistic
    setEditing(false)
    try {
      const result = await onSave(next)
      if (result !== true) {
        setLocalValue(value)   // revert
        setDraft(value ?? '')
        toast.error(typeof result === 'object' ? result.error : 'Failed to save')
      }
    } catch (e) {
      setLocalValue(value)
      setDraft(value ?? '')
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(localValue ?? '')
    setEditing(false)
  }

  if (readOnly) {
    return (
      <span className="text-sm text-gray-900">
        {format ? format(localValue) : (localValue ?? placeholder)}
      </span>
    )
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-left text-sm text-gray-900 w-full hover:bg-gray-50 px-2 py-1 -mx-2 -my-1 rounded cursor-text"
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      >
        {saving && <span className="text-xs text-gray-400 mr-1">saving…</span>}
        {format ? format(localValue) : (localValue || <span className="text-gray-400">{placeholder}</span>)}
      </button>
    )
  }

  if (type === 'select') {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        className="text-sm border rounded px-1 py-0.5 w-full"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">—</option>
        {(options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type === 'email' ? 'email' : type === 'phone' ? 'tel' : 'text'}
      className="text-sm border rounded px-1 py-0.5 w-full"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
```

- [ ] **Step 3.2: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3.3: Commit**

```bash
git add src/components/data-grid/editable-cell.tsx
git commit -m "feat(data-grid): EditableCell primitive with optimistic save"
```

---

## Task 4: Column header (sort + filter popover)

The `<ColumnHeader>` is what TanStack renders for each header cell. It owns the sort toggle and a filter popover whose UI depends on column meta.

**Files:**
- Create: `src/components/data-grid/column-header.tsx`
- Verify: `src/components/ui/popover.tsx`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx` exist (shadcn). If missing, install via `npx shadcn@latest add popover button input`.

- [ ] **Step 4.1: Verify shadcn primitives exist**

```bash
ls src/components/ui/popover.tsx src/components/ui/button.tsx src/components/ui/input.tsx
```

If any are missing, install them:

```bash
npx shadcn@latest add popover button input
```

- [ ] **Step 4.2: Write the component**

Create `src/components/data-grid/column-header.tsx`:

```typescript
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
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-6 w-6 p-0 ${filter ? 'text-primary' : 'text-gray-400 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100'}`}
            >
              <Filter className="w-3 h-3" />
            </Button>
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
```

- [ ] **Step 4.3: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4.4: Commit**

```bash
git add src/components/data-grid/column-header.tsx
git commit -m "feat(data-grid): ColumnHeader with sort toggle + filter popover"
```

---

## Task 5: Column visibility menu

A simple dropdown that lets the user show/hide columns. Reuses shadcn `DropdownMenu` + `Checkbox`.

**Files:**
- Create: `src/components/data-grid/column-visibility-menu.tsx`
- Verify: `src/components/ui/dropdown-menu.tsx`, `src/components/ui/checkbox.tsx` exist.

- [ ] **Step 5.1: Verify or install shadcn primitives**

```bash
ls src/components/ui/dropdown-menu.tsx src/components/ui/checkbox.tsx
```

If missing:

```bash
npx shadcn@latest add dropdown-menu checkbox
```

- [ ] **Step 5.2: Write the component**

Create `src/components/data-grid/column-visibility-menu.tsx`:

```typescript
'use client'

import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export interface ColumnDef { id: string; label: string; alwaysVisible?: boolean }

export interface ColumnVisibilityMenuProps {
  columns: ColumnDef[]
  visible: Set<string>
  defaults: string[]
  onChange: (next: string[]) => void
}

export function ColumnVisibilityMenu({ columns, visible, defaults, onChange }: ColumnVisibilityMenuProps) {
  function toggle(id: string) {
    const col = columns.find(c => c.id === id)
    if (col?.alwaysVisible) return
    const next = new Set(visible)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(columns.filter(c => next.has(c.id) || c.alwaysVisible).map(c => c.id))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <Columns3 className="w-4 h-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map(c => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={visible.has(c.id)}
            onSelect={(e) => { e.preventDefault(); toggle(c.id) }}
            disabled={c.alwaysVisible}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onChange(defaults) }}>
          Reset to defaults
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 5.3: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5.4: Commit**

```bash
git add src/components/data-grid/column-visibility-menu.tsx
git commit -m "feat(data-grid): ColumnVisibilityMenu dropdown"
```

---

## Task 6: Filter bar (active-filter chips)

Active-filter chips shown above the grid so the user can see what's filtering the view and clear them individually.

**Files:**
- Create: `src/components/data-grid/filter-bar.tsx`

- [ ] **Step 6.1: Write the component**

Create `src/components/data-grid/filter-bar.tsx`:

```typescript
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
```

- [ ] **Step 6.2: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 6.3: Commit**

```bash
git add src/components/data-grid/filter-bar.tsx
git commit -m "feat(data-grid): FilterBar with chip clear UI"
```

---

## Task 7: DataGrid composition

Wire the four primitives together with `@tanstack/react-table`. Generic over row type, accepts a typed column definition array.

**Files:**
- Create: `src/components/data-grid/data-grid.tsx`
- Create: `src/components/data-grid/index.ts` (barrel)

- [ ] **Step 7.1: Write the barrel**

Create `src/components/data-grid/index.ts`:

```typescript
export { DataGrid } from './data-grid'
export type { DataGridColumn, DataGridProps } from './data-grid'
export { EditableCell } from './editable-cell'
export type { EditableCellType, SelectOption } from './editable-cell'
```

- [ ] **Step 7.2: Write DataGrid**

Create `src/components/data-grid/data-grid.tsx`:

```typescript
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
```

Note: this implementation does sort/filter in hand-rolled memos, not via TanStack's row models. `@tanstack/react-table` is still installed in Task 1 because the project's planned next step (server-side filtering + virtualization for larger row counts) will use it. Don't import any symbols from it here.

- [ ] **Step 7.3: Run build**

```bash
npm run build
```

Expected: build succeeds. If the build complains about unused imports, replace the wide import block in `data-grid.tsx` with `import type {} from '@tanstack/react-table'` as noted.

- [ ] **Step 7.4: Commit**

```bash
git add src/components/data-grid/data-grid.tsx src/components/data-grid/index.ts
git commit -m "feat(data-grid): DataGrid composition with sort/filter/visibility"
```

---

## Task 8: PATCH endpoint for /api/admin/borrowers

Add a PATCH handler that mirrors the loan-officer one but without the loan-scope check. **The email-protection guard (no email change when `auth_user_id` is set) MUST be preserved.**

**Files:**
- Modify: `src/app/api/admin/borrowers/route.ts`

- [ ] **Step 8.1: Add the PATCH handler**

Edit `src/app/api/admin/borrowers/route.ts` and append (alongside the existing DELETE):

```typescript
// PATCH — Admins can edit borrower contact details (name / email / phone).
// Email is locked if the borrower has a portal login, to avoid breaking sign-in.
export async function PATCH(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { id, full_name, email, phone } = body as {
    id?: string; full_name?: string | null; email?: string; phone?: string | null
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const adminClient = createAdminClient()

  const { data: current } = await adminClient
    .from('borrowers').select('auth_user_id, email').eq('id', id).single()
  if (!current) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })

  const updates: Record<string, string | null> = {
    full_name: full_name ?? null,
    phone: phone ?? null,
  }
  if (!current.auth_user_id || email.trim() === current.email) {
    updates.email = email.trim()
  } else {
    return NextResponse.json({
      error: 'This borrower has a portal login — changing their email would break their sign-in. Have them request a password reset.',
    }, { status: 400 })
  }

  const { error } = await adminClient.from('borrowers').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 8.2: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 8.3: Commit**

```bash
git add src/app/api/admin/borrowers/route.ts
git commit -m "feat(api): PATCH /api/admin/borrowers with email-protection guard"
```

---

## Task 9: PATCH endpoint for /api/admin/brokers

Same as Task 8 but for brokers, including `company_name`.

**Files:**
- Modify: `src/app/api/admin/brokers/route.ts`

- [ ] **Step 9.1: Add the PATCH handler**

Append to `src/app/api/admin/brokers/route.ts`:

```typescript
export async function PATCH(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { id, full_name, email, phone, company_name } = body as {
    id?: string; full_name?: string | null; email?: string; phone?: string | null; company_name?: string | null
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const adminClient = createAdminClient()

  const { data: current } = await adminClient
    .from('brokers').select('auth_user_id, email').eq('id', id).single()
  if (!current) return NextResponse.json({ error: 'Broker not found' }, { status: 404 })

  const updates: Record<string, string | null> = {
    full_name: full_name ?? null,
    phone: phone ?? null,
    company_name: company_name ?? null,
  }
  if (!current.auth_user_id || email.trim() === current.email) {
    updates.email = email.trim()
  } else {
    return NextResponse.json({
      error: 'This broker has a portal login — changing their email would break their sign-in. Have them request a password reset.',
    }, { status: 400 })
  }

  const { error } = await adminClient.from('brokers').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 9.2: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 9.3: Commit**

```bash
git add src/app/api/admin/brokers/route.ts
git commit -m "feat(api): PATCH /api/admin/brokers with email-protection guard"
```

---

## Task 10: Migrate /admin/borrowers to DataGrid

Replace `AdminContactList` usage with a new client component that wires the borrower columns into `<DataGrid>`. The Server Component keeps its existing query + role gate.

**Files:**
- Modify: `src/app/admin/borrowers/page.tsx`
- Create: `src/app/admin/borrowers/admin-borrowers-grid.tsx`

- [ ] **Step 10.1: Update the Server Component to fetch additional fields**

Replace the borrower fetch in `src/app/admin/borrowers/page.tsx` so the query includes `created_at` and `auth_user_id` (for the new columns). The page should look approximately like this — but **adapt to the actual current file**, only changing the `.select(...)` and the rendered component:

```typescript
// Inside the existing async function — change the select call:
adminClient.from('borrowers')
  .select('id, full_name, email, phone, created_at, auth_user_id')
  .order('full_name'),
```

Replace the JSX that renders `<AdminContactList>` with:

```tsx
<AdminBorrowersGrid initialRows={rows} />
```

…where `rows` is constructed as:

```typescript
const rows = (borrowers ?? []).map(b => ({
  id: b.id,
  full_name: b.full_name,
  email: b.email,
  phone: b.phone,
  created_at: b.created_at,
  has_auth: !!b.auth_user_id,
  loan_count: loanCountById.get(b.id) ?? 0,
}))
```

(Reuse whatever the existing page calls the loan-count map.)

Add the import: `import { AdminBorrowersGrid } from './admin-borrowers-grid'`.

- [ ] **Step 10.2: Create the client grid component**

Create `src/app/admin/borrowers/admin-borrowers-grid.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DataGrid, type DataGridColumn, EditableCell } from '@/components/data-grid'

export interface AdminBorrowerRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  created_at: string | null
  has_auth: boolean
  loan_count: number
}

export function AdminBorrowersGrid({ initialRows }: { initialRows: AdminBorrowerRow[] }) {
  const [rows, setRows] = useState(initialRows)

  async function patch(id: string, field: 'full_name' | 'email' | 'phone', value: string | null): Promise<true | { error: string }> {
    const row = rows.find(r => r.id === id)
    if (!row) return { error: 'Row not found' }
    const res = await fetch('/api/admin/borrowers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        full_name: field === 'full_name' ? value : row.full_name,
        email: field === 'email' ? value : row.email,
        phone: field === 'phone' ? value : row.phone,
      }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Save failed' }
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
    return true
  }

  async function handleDelete(row: AdminBorrowerRow) {
    const name = row.full_name ?? row.email
    const loanWarning = row.loan_count > 0
      ? `\n\nThey are currently on ${row.loan_count} loan${row.loan_count === 1 ? '' : 's'} — their slot will be cleared (loans stay intact).`
      : ''
    if (!confirm(`Delete borrower ${name}?${loanWarning}\n\nThis also removes their portal login. This can't be undone.`)) return

    const res = await fetch('/api/admin/borrowers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id }),
    })
    const data = await res.json()
    if (data.success) {
      setRows(prev => prev.filter(r => r.id !== row.id))
      toast.success(`${name} deleted`)
    } else {
      toast.error(data.error ?? 'Delete failed')
    }
  }

  const columns: DataGridColumn<AdminBorrowerRow>[] = [
    {
      id: 'full_name', label: 'Name', filterKind: 'contains', alwaysVisible: true,
      accessor: (r) => r.full_name ?? '',
      cell: (r) => (
        <EditableCell type="text" value={r.full_name} placeholder="—"
          onSave={(v) => patch(r.id, 'full_name', v)} />
      ),
      width: 'w-56',
    },
    {
      id: 'email', label: 'Email', filterKind: 'contains',
      accessor: (r) => r.email,
      cell: (r) => (
        <EditableCell type="email" value={r.email}
          readOnly={r.has_auth}
          onSave={(v) => patch(r.id, 'email', v)} />
      ),
      width: 'w-64',
    },
    {
      id: 'phone', label: 'Phone', filterKind: 'contains',
      accessor: (r) => r.phone ?? '',
      cell: (r) => (
        <EditableCell type="phone" value={r.phone}
          onSave={(v) => patch(r.id, 'phone', v)} />
      ),
      width: 'w-40',
    },
    {
      id: 'loan_count', label: 'Loans', filterKind: 'range',
      accessor: (r) => r.loan_count,
      cell: (r) => <span className="text-sm tabular-nums">{r.loan_count}</span>,
      width: 'w-20',
    },
    {
      id: 'has_auth', label: 'Status', filterKind: 'multi',
      filterOptions: [{ label: 'Active', value: 'active' }, { label: 'Invited', value: 'invited' }],
      accessor: (r) => r.has_auth ? 'active' : 'invited',
      cell: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${r.has_auth ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {r.has_auth ? 'Active' : 'Invited'}
        </span>
      ),
      width: 'w-24',
    },
    {
      id: 'created_at', label: 'Created', filterKind: 'none',
      accessor: (r) => r.created_at ?? '',
      cell: (r) => <span className="text-sm text-gray-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</span>,
      width: 'w-32',
    },
    {
      id: 'actions', label: '', sortable: false, filterKind: 'none', alwaysVisible: true,
      accessor: () => '',
      cell: (r) => (
        <button
          type="button"
          onClick={() => handleDelete(r)}
          className="text-gray-400 hover:text-red-600 p-1"
          aria-label="Delete borrower"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      ),
      width: 'w-12',
    },
  ]

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      defaultVisibleColumns={['full_name', 'email', 'phone', 'loan_count', 'has_auth', 'actions']}
      rowHref={(r) => `/admin/borrowers/${r.id}`}
      emptyState="No borrowers yet."
    />
  )
}
```

- [ ] **Step 10.3: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 10.4: Manual smoke test**

```bash
npm run dev
```

In a browser: log in as an admin, visit `/admin/borrowers`. Verify:
- Grid renders with default columns.
- Toggle a column off via the Columns menu — URL updates with `?cols=…`.
- Click "Name" header — rows sort; URL updates with `?sort=full_name:asc`.
- Click the filter icon on Email, type a substring — rows filter; URL updates with `?filter:email=…`.
- Click a Name cell — input appears; type a new name; press Enter — saves (network tab shows `PATCH /api/admin/borrowers`).
- Click the chevron at the right of a row — navigates to `/admin/borrowers/[id]` (will 404 until Task 12 — that's expected).
- Delete icon still works.

- [ ] **Step 10.5: Commit**

```bash
git add src/app/admin/borrowers/page.tsx src/app/admin/borrowers/admin-borrowers-grid.tsx
git commit -m "feat(admin): migrate /admin/borrowers to DataGrid"
```

---

## Task 11: Migrate /admin/brokers to DataGrid

Same pattern as Task 10 but with `company_name` as an editable column.

**Files:**
- Modify: `src/app/admin/brokers/page.tsx`
- Create: `src/app/admin/brokers/admin-brokers-grid.tsx`

- [ ] **Step 11.1: Update the Server Component**

In `src/app/admin/brokers/page.tsx`, update the select to include `created_at` and `auth_user_id`:

```typescript
adminClient.from('brokers')
  .select('id, full_name, email, phone, company_name, created_at, auth_user_id')
  .order('full_name'),
```

Construct rows including `has_auth` and `loan_count`, then render:

```tsx
<AdminBrokersGrid initialRows={rows} />
```

- [ ] **Step 11.2: Create the client grid**

Create `src/app/admin/brokers/admin-brokers-grid.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DataGrid, type DataGridColumn, EditableCell } from '@/components/data-grid'

export interface AdminBrokerRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  company_name: string | null
  created_at: string | null
  has_auth: boolean
  loan_count: number
}

export function AdminBrokersGrid({ initialRows }: { initialRows: AdminBrokerRow[] }) {
  const [rows, setRows] = useState(initialRows)

  async function patch(
    id: string,
    field: 'full_name' | 'email' | 'phone' | 'company_name',
    value: string | null,
  ): Promise<true | { error: string }> {
    const row = rows.find(r => r.id === id)
    if (!row) return { error: 'Row not found' }
    const res = await fetch('/api/admin/brokers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        full_name: field === 'full_name' ? value : row.full_name,
        email: field === 'email' ? value : row.email,
        phone: field === 'phone' ? value : row.phone,
        company_name: field === 'company_name' ? value : row.company_name,
      }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Save failed' }
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
    return true
  }

  async function handleDelete(row: AdminBrokerRow) {
    const name = row.full_name ?? row.email
    const loanWarning = row.loan_count > 0
      ? `\n\nThey are currently on ${row.loan_count} loan${row.loan_count === 1 ? '' : 's'} — their slot will be cleared (loans stay intact).`
      : ''
    if (!confirm(`Delete broker ${name}?${loanWarning}\n\nThis also removes their portal login. This can't be undone.`)) return

    const res = await fetch('/api/admin/brokers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id }),
    })
    const data = await res.json()
    if (data.success) {
      setRows(prev => prev.filter(r => r.id !== row.id))
      toast.success(`${name} deleted`)
    } else {
      toast.error(data.error ?? 'Delete failed')
    }
  }

  const columns: DataGridColumn<AdminBrokerRow>[] = [
    {
      id: 'full_name', label: 'Name', filterKind: 'contains', alwaysVisible: true,
      accessor: (r) => r.full_name ?? '',
      cell: (r) => <EditableCell type="text" value={r.full_name} onSave={(v) => patch(r.id, 'full_name', v)} />,
      width: 'w-48',
    },
    {
      id: 'company_name', label: 'Company', filterKind: 'contains',
      accessor: (r) => r.company_name ?? '',
      cell: (r) => <EditableCell type="text" value={r.company_name} onSave={(v) => patch(r.id, 'company_name', v)} />,
      width: 'w-48',
    },
    {
      id: 'email', label: 'Email', filterKind: 'contains',
      accessor: (r) => r.email,
      cell: (r) => <EditableCell type="email" value={r.email} readOnly={r.has_auth} onSave={(v) => patch(r.id, 'email', v)} />,
      width: 'w-56',
    },
    {
      id: 'phone', label: 'Phone', filterKind: 'contains',
      accessor: (r) => r.phone ?? '',
      cell: (r) => <EditableCell type="phone" value={r.phone} onSave={(v) => patch(r.id, 'phone', v)} />,
      width: 'w-40',
    },
    {
      id: 'loan_count', label: 'Loans', filterKind: 'range',
      accessor: (r) => r.loan_count,
      cell: (r) => <span className="text-sm tabular-nums">{r.loan_count}</span>,
      width: 'w-20',
    },
    {
      id: 'has_auth', label: 'Status', filterKind: 'multi',
      filterOptions: [{ label: 'Active', value: 'active' }, { label: 'Invited', value: 'invited' }],
      accessor: (r) => r.has_auth ? 'active' : 'invited',
      cell: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${r.has_auth ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {r.has_auth ? 'Active' : 'Invited'}
        </span>
      ),
      width: 'w-24',
    },
    {
      id: 'created_at', label: 'Created', filterKind: 'none',
      accessor: (r) => r.created_at ?? '',
      cell: (r) => <span className="text-sm text-gray-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</span>,
      width: 'w-32',
    },
    {
      id: 'actions', label: '', sortable: false, filterKind: 'none', alwaysVisible: true,
      accessor: () => '',
      cell: (r) => (
        <button type="button" onClick={() => handleDelete(r)} className="text-gray-400 hover:text-red-600 p-1" aria-label="Delete broker">
          <Trash2 className="w-4 h-4" />
        </button>
      ),
      width: 'w-12',
    },
  ]

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      defaultVisibleColumns={['full_name', 'company_name', 'email', 'phone', 'loan_count', 'has_auth', 'actions']}
      rowHref={(r) => `/admin/brokers/${r.id}`}
      emptyState="No brokers yet."
    />
  )
}
```

- [ ] **Step 11.3: Run build and smoke test**

```bash
npm run build && npm run dev
```

Visit `/admin/brokers`. Same checks as Task 10 plus: edit the Company cell.

- [ ] **Step 11.4: Commit**

```bash
git add src/app/admin/brokers/page.tsx src/app/admin/brokers/admin-brokers-grid.tsx
git commit -m "feat(admin): migrate /admin/brokers to DataGrid"
```

---

## Task 12: Admin borrower detail page

A simple Server Component that fetches the borrower + their linked loans and renders both. The chevron-navigate from Task 10 points here.

**Files:**
- Create: `src/app/admin/borrowers/[id]/page.tsx`

- [ ] **Step 12.1: Write the detail page**

Create `src/app/admin/borrowers/[id]/page.tsx`:

```tsx
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function AdminBorrowerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient.from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const { data: borrower } = await adminClient
    .from('borrowers')
    .select('id, full_name, email, phone, created_at, auth_user_id')
    .eq('id', id)
    .single()
  if (!borrower) notFound()

  // Find loans this borrower is on (any slot)
  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address, loan_stage, updated_at')
    .or(`borrower_id.eq.${id},borrower_id_2.eq.${id},borrower_id_3.eq.${id},borrower_id_4.eq.${id}`)
    .order('updated_at', { ascending: false })

  return (
    <PortalShell userName={user.email ?? ''} userRole="Administrator" dashboardHref="/admin" variant="admin">
      <div className="mb-4">
        <Link href="/admin/borrowers" className="text-sm text-primary hover:underline">← All borrowers</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{borrower.full_name ?? borrower.email}</h1>
      <p className="text-sm text-gray-500 mb-6">{borrower.auth_user_id ? 'Active portal account' : 'Invited (no portal login yet)'}</p>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Contact info</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500">Email</dt><dd>{borrower.email}</dd>
            <dt className="text-gray-500">Phone</dt><dd>{borrower.phone ?? '—'}</dd>
            <dt className="text-gray-500">Created</dt><dd>{borrower.created_at ? new Date(borrower.created_at).toLocaleString() : '—'}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Loans</CardTitle></CardHeader>
        <CardContent>
          {!loans?.length ? (
            <p className="text-sm text-gray-400">Not on any loans.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {loans.map(l => (
                <li key={l.id} className="py-2 flex items-center justify-between gap-3">
                  <Link href={`/admin/loans/${l.id}`} className="text-sm text-primary hover:underline truncate">
                    {l.property_address ?? '(no address)'}
                  </Link>
                  <span className="text-xs text-gray-500 shrink-0">{l.loan_stage ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
```

- [ ] **Step 12.2: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 12.3: Smoke**

```bash
npm run dev
```

Visit `/admin/borrowers`, click a chevron. Detail page renders with contact info + loans list.

- [ ] **Step 12.4: Commit**

```bash
git add src/app/admin/borrowers/[id]/page.tsx
git commit -m "feat(admin): borrower detail page"
```

---

## Task 13: Admin broker detail page

Same as Task 12 but for brokers.

**Files:**
- Create: `src/app/admin/brokers/[id]/page.tsx`

- [ ] **Step 13.1: Write the detail page**

Create `src/app/admin/brokers/[id]/page.tsx`:

```tsx
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function AdminBrokerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const { data: broker } = await adminClient
    .from('brokers')
    .select('id, full_name, email, phone, company_name, created_at, auth_user_id')
    .eq('id', id)
    .single()
  if (!broker) notFound()

  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address, loan_stage, updated_at')
    .or(`broker_id.eq.${id},broker_id_2.eq.${id}`)
    .order('updated_at', { ascending: false })

  return (
    <PortalShell userName={user.email ?? ''} userRole="Administrator" dashboardHref="/admin" variant="admin">
      <div className="mb-4">
        <Link href="/admin/brokers" className="text-sm text-primary hover:underline">← All brokers</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{broker.full_name ?? broker.email}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {broker.company_name ?? '—'}{' · '}{broker.auth_user_id ? 'Active portal account' : 'Invited (no portal login yet)'}
      </p>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Contact info</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500">Company</dt><dd>{broker.company_name ?? '—'}</dd>
            <dt className="text-gray-500">Email</dt><dd>{broker.email}</dd>
            <dt className="text-gray-500">Phone</dt><dd>{broker.phone ?? '—'}</dd>
            <dt className="text-gray-500">Created</dt><dd>{broker.created_at ? new Date(broker.created_at).toLocaleString() : '—'}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Loans</CardTitle></CardHeader>
        <CardContent>
          {!loans?.length ? (
            <p className="text-sm text-gray-400">Not on any loans.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {loans.map(l => (
                <li key={l.id} className="py-2 flex items-center justify-between gap-3">
                  <Link href={`/admin/loans/${l.id}`} className="text-sm text-primary hover:underline truncate">
                    {l.property_address ?? '(no address)'}
                  </Link>
                  <span className="text-xs text-gray-500 shrink-0">{l.loan_stage ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
```

- [ ] **Step 13.2: Run build + smoke**

```bash
npm run build && npm run dev
```

Visit `/admin/brokers`, click a chevron.

- [ ] **Step 13.3: Commit**

```bash
git add src/app/admin/brokers/[id]/page.tsx
git commit -m "feat(admin): broker detail page"
```

---

## Task 14: Migrate /loan-officer/borrowers to DataGrid

Replace `EditableContactList` with the grid. Add the `last_loan_activity` column (hidden by default; opt-in via columns menu). Chevron navigates to the most-recently-updated loan the borrower is on.

**Files:**
- Modify: `src/app/loan-officer/borrowers/page.tsx`
- Create: `src/app/loan-officer/borrowers/lo-borrowers-grid.tsx`

- [ ] **Step 14.1: Update the Server Component**

Edit `src/app/loan-officer/borrowers/page.tsx`. After computing the list of borrower ids, also fetch loans (already partly done) but also pull the most-recent loan per borrower for the chevron:

```typescript
// After computing loanCountById and ids:

// For each borrower, find the loan with the most-recent updated_at across this LO's loans.
// We already have the loans query rows; widen it to include updated_at + property_address.
const { data: loanRows } = await adminClient
  .from('loans')
  .select('id, property_address, updated_at, loan_stage, borrower_id, borrower_id_2, borrower_id_3, borrower_id_4')
  .eq('loan_officer_id', lo.id)
  .eq('archived', false)
  .order('updated_at', { ascending: false })

const mostRecentLoanByBorrower = new Map<string, { id: string; stage: string | null; updated_at: string }>()
for (const r of loanRows ?? []) {
  for (const bid of [r.borrower_id, r.borrower_id_2, r.borrower_id_3, r.borrower_id_4]) {
    if (!bid) continue
    if (!mostRecentLoanByBorrower.has(bid)) {
      mostRecentLoanByBorrower.set(bid, { id: r.id, stage: r.loan_stage, updated_at: r.updated_at })
    }
  }
}
```

Then build the row array (replacing the existing `EditableContactList` initial array):

```typescript
const rows = (borrowers ?? []).map(b => {
  const mostRecent = mostRecentLoanByBorrower.get(b.id) ?? null
  return {
    id: b.id,
    full_name: b.full_name,
    email: b.email,
    phone: b.phone,
    loan_count: loanCountById.get(b.id) ?? 0,
    most_recent_loan_id: mostRecent?.id ?? null,
    last_loan_stage: mostRecent?.stage ?? null,
    last_loan_activity: mostRecent?.updated_at ?? null,
  }
})
```

Render:

```tsx
<LoBorrowersGrid initialRows={rows} />
```

Add the import. Remove the import of `EditableContactList`.

- [ ] **Step 14.2: Create the client grid**

Create `src/app/loan-officer/borrowers/lo-borrowers-grid.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { DataGrid, type DataGridColumn, EditableCell } from '@/components/data-grid'

export interface LoBorrowerRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  loan_count: number
  most_recent_loan_id: string | null
  last_loan_stage: string | null
  last_loan_activity: string | null
}

export function LoBorrowersGrid({ initialRows }: { initialRows: LoBorrowerRow[] }) {
  const [rows, setRows] = useState(initialRows)

  async function patch(id: string, field: 'full_name' | 'email' | 'phone', value: string | null): Promise<true | { error: string }> {
    const row = rows.find(r => r.id === id)
    if (!row) return { error: 'Row not found' }
    const res = await fetch('/api/loan-officer/borrowers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        full_name: field === 'full_name' ? value : row.full_name,
        email: field === 'email' ? value : row.email,
        phone: field === 'phone' ? value : row.phone,
      }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Save failed' }
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
    return true
  }

  const columns: DataGridColumn<LoBorrowerRow>[] = [
    {
      id: 'full_name', label: 'Name', filterKind: 'contains', alwaysVisible: true,
      accessor: (r) => r.full_name ?? '',
      cell: (r) => <EditableCell type="text" value={r.full_name} onSave={(v) => patch(r.id, 'full_name', v)} />,
      width: 'w-56',
    },
    {
      id: 'email', label: 'Email', filterKind: 'contains',
      accessor: (r) => r.email,
      cell: (r) => <EditableCell type="email" value={r.email} onSave={(v) => patch(r.id, 'email', v)} />,
      width: 'w-64',
    },
    {
      id: 'phone', label: 'Phone', filterKind: 'contains',
      accessor: (r) => r.phone ?? '',
      cell: (r) => <EditableCell type="phone" value={r.phone} onSave={(v) => patch(r.id, 'phone', v)} />,
      width: 'w-40',
    },
    {
      id: 'loan_count', label: 'Loans', filterKind: 'range',
      accessor: (r) => r.loan_count,
      cell: (r) => <span className="text-sm tabular-nums">{r.loan_count}</span>,
      width: 'w-20',
    },
    {
      id: 'last_loan_stage', label: 'Last stage', filterKind: 'contains',
      accessor: (r) => r.last_loan_stage ?? '',
      cell: (r) => <span className="text-sm text-gray-700">{r.last_loan_stage ?? '—'}</span>,
      width: 'w-40',
    },
    {
      id: 'last_loan_activity', label: 'Last activity', filterKind: 'none',
      accessor: (r) => r.last_loan_activity ?? '',
      cell: (r) => <span className="text-sm text-gray-500">{r.last_loan_activity ? new Date(r.last_loan_activity).toLocaleDateString() : '—'}</span>,
      width: 'w-32',
    },
  ]

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      defaultVisibleColumns={['full_name', 'email', 'phone', 'loan_count']}
      rowHref={(r) => r.most_recent_loan_id ? `/loan-officer/loans/${r.most_recent_loan_id}` : null}
      emptyState="No borrowers across your loans yet."
    />
  )
}
```

- [ ] **Step 14.3: Run build + smoke**

```bash
npm run build && npm run dev
```

Sign in as a loan officer. Visit `/loan-officer/borrowers`. Verify edit + chevron-to-loan.

- [ ] **Step 14.4: Commit**

```bash
git add src/app/loan-officer/borrowers/page.tsx src/app/loan-officer/borrowers/lo-borrowers-grid.tsx
git commit -m "feat(lo): migrate /loan-officer/borrowers to DataGrid"
```

---

## Task 15: Migrate /loan-officer/brokers to DataGrid

Same pattern as Task 14 but for brokers (with `company_name`). Uses the existing PATCH endpoint `/api/loan-officer/brokers`.

**Files:**
- Modify: `src/app/loan-officer/brokers/page.tsx`
- Create: `src/app/loan-officer/brokers/lo-brokers-grid.tsx`

- [ ] **Step 15.1: Confirm the PATCH endpoint exists**

```bash
ls src/app/api/loan-officer/brokers/route.ts
```

If missing, copy the borrowers PATCH and adapt it for brokers (add `company_name` to the writable fields, and search loans via `broker_id.eq.${id},broker_id_2.eq.${id}` instead of borrower slots). If present, read it to confirm it accepts `{ id, full_name, email, phone, company_name }`.

- [ ] **Step 15.2: Update the Server Component**

Edit `src/app/loan-officer/brokers/page.tsx`. Mirror Task 14.1 but using broker fields. Compute `mostRecentLoanByBroker` via `broker_id` / `broker_id_2`. Render:

```tsx
<LoBrokersGrid initialRows={rows} />
```

- [ ] **Step 15.3: Create the client grid**

Create `src/app/loan-officer/brokers/lo-brokers-grid.tsx` modeled on `lo-borrowers-grid.tsx` from Task 14 with an additional `company_name` column (editable), and `apiPath` set to `/api/loan-officer/brokers`. Default visible columns: `['full_name', 'company_name', 'email', 'phone', 'loan_count']`.

(Full code is identical to Task 14.2 except for the extra `company_name` column and `most_recent_loan_id` source. Reproduce in full to avoid out-of-order reading bugs.)

```tsx
'use client'

import { useState } from 'react'
import { DataGrid, type DataGridColumn, EditableCell } from '@/components/data-grid'

export interface LoBrokerRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  company_name: string | null
  loan_count: number
  most_recent_loan_id: string | null
  last_loan_stage: string | null
  last_loan_activity: string | null
}

export function LoBrokersGrid({ initialRows }: { initialRows: LoBrokerRow[] }) {
  const [rows, setRows] = useState(initialRows)

  async function patch(
    id: string,
    field: 'full_name' | 'email' | 'phone' | 'company_name',
    value: string | null,
  ): Promise<true | { error: string }> {
    const row = rows.find(r => r.id === id)
    if (!row) return { error: 'Row not found' }
    const res = await fetch('/api/loan-officer/brokers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        full_name: field === 'full_name' ? value : row.full_name,
        email: field === 'email' ? value : row.email,
        phone: field === 'phone' ? value : row.phone,
        company_name: field === 'company_name' ? value : row.company_name,
      }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Save failed' }
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
    return true
  }

  const columns: DataGridColumn<LoBrokerRow>[] = [
    {
      id: 'full_name', label: 'Name', filterKind: 'contains', alwaysVisible: true,
      accessor: (r) => r.full_name ?? '',
      cell: (r) => <EditableCell type="text" value={r.full_name} onSave={(v) => patch(r.id, 'full_name', v)} />,
      width: 'w-48',
    },
    {
      id: 'company_name', label: 'Company', filterKind: 'contains',
      accessor: (r) => r.company_name ?? '',
      cell: (r) => <EditableCell type="text" value={r.company_name} onSave={(v) => patch(r.id, 'company_name', v)} />,
      width: 'w-48',
    },
    {
      id: 'email', label: 'Email', filterKind: 'contains',
      accessor: (r) => r.email,
      cell: (r) => <EditableCell type="email" value={r.email} onSave={(v) => patch(r.id, 'email', v)} />,
      width: 'w-56',
    },
    {
      id: 'phone', label: 'Phone', filterKind: 'contains',
      accessor: (r) => r.phone ?? '',
      cell: (r) => <EditableCell type="phone" value={r.phone} onSave={(v) => patch(r.id, 'phone', v)} />,
      width: 'w-40',
    },
    {
      id: 'loan_count', label: 'Loans', filterKind: 'range',
      accessor: (r) => r.loan_count,
      cell: (r) => <span className="text-sm tabular-nums">{r.loan_count}</span>,
      width: 'w-20',
    },
    {
      id: 'last_loan_stage', label: 'Last stage', filterKind: 'contains',
      accessor: (r) => r.last_loan_stage ?? '',
      cell: (r) => <span className="text-sm text-gray-700">{r.last_loan_stage ?? '—'}</span>,
      width: 'w-40',
    },
    {
      id: 'last_loan_activity', label: 'Last activity', filterKind: 'none',
      accessor: (r) => r.last_loan_activity ?? '',
      cell: (r) => <span className="text-sm text-gray-500">{r.last_loan_activity ? new Date(r.last_loan_activity).toLocaleDateString() : '—'}</span>,
      width: 'w-32',
    },
  ]

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      defaultVisibleColumns={['full_name', 'company_name', 'email', 'phone', 'loan_count']}
      rowHref={(r) => r.most_recent_loan_id ? `/loan-officer/loans/${r.most_recent_loan_id}` : null}
      emptyState="No brokers across your loans yet."
    />
  )
}
```

- [ ] **Step 15.4: Run build + smoke**

```bash
npm run build && npm run dev
```

- [ ] **Step 15.5: Commit**

```bash
git add src/app/loan-officer/brokers/page.tsx src/app/loan-officer/brokers/lo-brokers-grid.tsx
git commit -m "feat(lo): migrate /loan-officer/brokers to DataGrid"
```

---

## Task 16: Migrate /loan-officer/vendors to unified DataGrid

Generalize the existing `aggregate()` function into a single flat list with a `type` field. Render through the grid. Cells are read-only (v1).

**Files:**
- Modify: `src/app/loan-officer/vendors/page.tsx`
- Create: `src/app/loan-officer/vendors/lo-vendors-grid.tsx`

- [ ] **Step 16.1: Refactor the Server Component aggregator**

Replace the body of `src/app/loan-officer/vendors/page.tsx` so it builds a single flat array of `VendorRow`:

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { LoVendorsGrid, type VendorRow } from './lo-vendors-grid'

interface DetailRow {
  loan_id: string
  title_company: string | null;  title_email: string | null;  title_phone: string | null
  insurance_company: string | null;  insurance_email: string | null;  insurance_phone: string | null
  appraisal_company: string | null;  appraisal_email: string | null;  appraisal_phone: string | null
}

function vendorKey(s: string | null): string | null {
  if (!s) return null
  const k = s.trim().toLowerCase()
  return k || null
}

export default async function LoanOfficerVendorsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) redirect('/login')

  const { data: loans } = await adminClient
    .from('loans').select('id, property_address').eq('loan_officer_id', lo.id).eq('archived', false)
  const loansById = new Map((loans ?? []).map(l => [l.id, l]))
  const loanIds = [...loansById.keys()]

  const { data: details } = loanIds.length > 0
    ? await adminClient
        .from('loan_details')
        .select('loan_id, title_company, title_email, title_phone, insurance_company, insurance_email, insurance_phone, appraisal_company, appraisal_email, appraisal_phone')
        .in('loan_id', loanIds)
    : { data: [] }

  type VendorBucket = { name: string; type: 'title' | 'insurance' | 'appraisal'; emails: Set<string>; phones: Set<string>; loanIds: Set<string> }
  const buckets = new Map<string, VendorBucket>()

  function ingest(kind: 'title' | 'insurance' | 'appraisal', rows: DetailRow[]) {
    for (const r of rows) {
      const name = kind === 'title' ? r.title_company : kind === 'insurance' ? r.insurance_company : r.appraisal_company
      const email = kind === 'title' ? r.title_email : kind === 'insurance' ? r.insurance_email : r.appraisal_email
      const phone = kind === 'title' ? r.title_phone : kind === 'insurance' ? r.insurance_phone : r.appraisal_phone
      const key = vendorKey(name)
      if (!key) continue
      const bucketKey = `${kind}::${key}`
      let bucket = buckets.get(bucketKey)
      if (!bucket) {
        bucket = { name: name!.trim(), type: kind, emails: new Set(), phones: new Set(), loanIds: new Set() }
        buckets.set(bucketKey, bucket)
      }
      if (email?.trim()) bucket.emails.add(email.trim())
      if (phone?.trim()) bucket.phones.add(phone.trim())
      bucket.loanIds.add(r.loan_id)
    }
  }

  ingest('title', (details ?? []) as DetailRow[])
  ingest('insurance', (details ?? []) as DetailRow[])
  ingest('appraisal', (details ?? []) as DetailRow[])

  const rows: VendorRow[] = [...buckets.values()].map((b, i) => ({
    id: `${b.type}-${i}`,
    name: b.name,
    type: b.type,
    emails: [...b.emails],
    phones: [...b.phones],
    loan_count: b.loanIds.size,
    loan_ids: [...b.loanIds],
    loan_addresses: [...b.loanIds].map(id => loansById.get(id)?.property_address ?? '(no address)'),
  }))

  return (
    <PortalShell
      userName={lo.full_name}
      userRole="Loan Officer"
      dashboardHref="/loan-officer/inbox"
      variant="loan-officer"
      maxWidth="max-w-6xl"
    >
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Vendors</h2>
      <p className="text-sm text-gray-500 mb-6">
        Title companies, insurance companies, and appraisers attached to your loans (derived
        from the Loan Details section on each file). Filter by type or sort by loan count to triage.
      </p>
      <LoVendorsGrid initialRows={rows} />
    </PortalShell>
  )
}
```

- [ ] **Step 16.2: Create the client grid**

Create `src/app/loan-officer/vendors/lo-vendors-grid.tsx`:

```tsx
'use client'

import { DataGrid, type DataGridColumn } from '@/components/data-grid'

export interface VendorRow {
  id: string
  name: string
  type: 'title' | 'insurance' | 'appraisal'
  emails: string[]
  phones: string[]
  loan_count: number
  loan_ids: string[]
  loan_addresses: string[]
}

const TYPE_LABEL: Record<VendorRow['type'], string> = {
  title: 'Title',
  insurance: 'Insurance',
  appraisal: 'Appraisal',
}

export function LoVendorsGrid({ initialRows }: { initialRows: VendorRow[] }) {
  const columns: DataGridColumn<VendorRow>[] = [
    {
      id: 'name', label: 'Name', filterKind: 'contains', alwaysVisible: true,
      accessor: (r) => r.name,
      cell: (r) => <span className="text-sm font-medium text-gray-900">{r.name}</span>,
      width: 'w-56',
    },
    {
      id: 'type', label: 'Type', filterKind: 'multi',
      filterOptions: [
        { label: 'Title', value: 'title' },
        { label: 'Insurance', value: 'insurance' },
        { label: 'Appraisal', value: 'appraisal' },
      ],
      accessor: (r) => r.type,
      cell: (r) => {
        const colors = {
          title: 'bg-blue-50 text-blue-700',
          insurance: 'bg-purple-50 text-purple-700',
          appraisal: 'bg-amber-50 text-amber-700',
        } as const
        return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[r.type]}`}>{TYPE_LABEL[r.type]}</span>
      },
      width: 'w-28',
    },
    {
      id: 'emails', label: 'Emails', filterKind: 'contains',
      accessor: (r) => r.emails.join(', '),
      cell: (r) => <span className="text-sm text-gray-700">{r.emails.join(', ') || '—'}</span>,
      width: 'w-64',
    },
    {
      id: 'phones', label: 'Phones', filterKind: 'contains',
      accessor: (r) => r.phones.join(', '),
      cell: (r) => <span className="text-sm text-gray-700">{r.phones.join(', ') || '—'}</span>,
      width: 'w-48',
    },
    {
      id: 'loan_count', label: 'Loans', filterKind: 'range',
      accessor: (r) => r.loan_count,
      cell: (r) => (
        <details>
          <summary className="text-sm tabular-nums cursor-pointer hover:text-primary list-none">
            {r.loan_count}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {r.loan_ids.map((lid, i) => (
              <li key={lid}>
                <a href={`/loan-officer/loans/${lid}`} className="text-xs text-primary hover:underline">
                  {r.loan_addresses[i] ?? '(no address)'}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ),
      width: 'w-32',
    },
  ]

  return (
    <DataGrid
      rows={initialRows}
      columns={columns}
      defaultVisibleColumns={['name', 'type', 'emails', 'phones', 'loan_count']}
      emptyState="No vendors across your active loans yet."
    />
  )
}
```

- [ ] **Step 16.3: Run build + smoke**

```bash
npm run build && npm run dev
```

Visit `/loan-officer/vendors`. Verify the Type column filter chip behavior (default = all; uncheck Title → only insurance + appraisal rows show).

- [ ] **Step 16.4: Commit**

```bash
git add src/app/loan-officer/vendors/page.tsx src/app/loan-officer/vendors/lo-vendors-grid.tsx
git commit -m "feat(lo): migrate /loan-officer/vendors to unified DataGrid"
```

---

## Task 17: Retire dead components

Delete `AdminContactList` and `EditableContactList`. Build will fail if anything still uses them.

**Files:**
- Delete: `src/components/admin-contact-list.tsx`
- Delete: `src/components/editable-contact-list.tsx`

- [ ] **Step 17.1: Confirm no remaining imports**

```bash
grep -rn "AdminContactList\|EditableContactList" src/
```

Expected: only the files themselves match. If anything else does, fix it first (probably an admin contact page for processors/underwriters not in scope of this plan — leave its imports alone if so, and **skip** deleting that component).

If grep returns matches in files this plan did not touch (e.g. `/admin/loan-processors/page.tsx`), do **not** delete the component. Stop, report to the user. Otherwise continue.

- [ ] **Step 17.2: Delete the files (only if Step 17.1 cleared)**

```bash
rm src/components/admin-contact-list.tsx
rm src/components/editable-contact-list.tsx
```

- [ ] **Step 17.3: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 17.4: Commit**

```bash
git add -A
git commit -m "chore: retire AdminContactList + EditableContactList"
```

---

## Task 18: Verification sweep

Manual end-to-end check across all five surfaces. This is the correctness gate — there are no automated tests.

**Files:** none modified.

- [ ] **Step 18.1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 18.2: Admin sweep**

Sign in as an admin. For each of `/admin/borrowers` and `/admin/brokers`:
1. Default columns render. Toggle one off → URL updates `?cols=…`. Refresh → state persists.
2. Sort each column ascending and descending → URL updates `?sort=…`.
3. Open a filter popover → enter a value → matching rows only → URL updates `?filter:…`. Clear via the chip in the filter bar.
4. Click a Name cell → input appears → edit → press Enter → optimistic update → network PATCH succeeds.
5. Click Email on a row whose Status = "Active" → cell is read-only.
6. Click the chevron at end of row → navigates to `/admin/[borrowers|brokers]/[id]`. Detail page renders with linked loans.
7. Delete a row via the trash icon → confirm dialog → deletion succeeds.

- [ ] **Step 18.3: Loan officer sweep**

Sign in as a loan officer. For `/loan-officer/borrowers`, `/loan-officer/brokers`, `/loan-officer/vendors`:
1. Grid renders only their scoped contacts (not all). Default columns render.
2. Sort, filter, show/hide, URL persistence work as above.
3. Inline edit works on borrower/broker grids; vendor cells are read-only.
4. Chevron on borrower/broker rows navigates to the most-recent loan; vendor "Loans" column expands inline to show every loan they touch.

- [ ] **Step 18.4: Role-gate verification**

Run the project's `playwright-role-gates` skill via Claude Code:

```text
/skill playwright-role-gates
```

Confirm: admin can reach `/admin/*`; LO cannot reach `/admin/*` and gets redirected; borrower cannot reach LO or admin routes.

- [ ] **Step 18.5: Production build**

```bash
npm run build
```

Expected: succeeds with no errors or warnings beyond pre-existing ones.

---

## Self-review checklist

Before opening the PR:

- [ ] All 19 tasks (0 through 18) committed individually with descriptive messages.
- [ ] `npm run build` succeeds.
- [ ] No `AdminContactList` or `EditableContactList` references remain in `src/`.
- [ ] All five surfaces tested manually and pass the smoke checks.
- [ ] Role-gates verified.
- [ ] Spec referenced in the PR description.
- [ ] Mention in the PR that vendors-as-real-data is a deliberate follow-up (link to the spec's "Non-goals" section).

---

## Notes for the executor

- **Branch:** all work happens on `feature/loan-application-intake` after Task 0's merge. Do not push to `main`.
- **No tests:** this codebase has no Vitest/Jest setup. The TDD pattern in the writing-plans template is replaced with `npm run build` + manual browser checks at each task boundary.
- **Email guard:** every PATCH endpoint (admin and LO) must refuse to change `email` when `auth_user_id` is set. Both Task 8 and Task 9 include this — do not remove it.
- **No nav changes:** the sidebar items already exist on `main` (which Task 0 merges in). This plan does not modify `portal-shell.tsx`.
- **Detail-page auth:** new admin detail pages reuse the existing role-gate pattern. Do not invent new auth helpers.
