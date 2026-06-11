'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export type SortField =
  | 'last_updated'
  | 'lp_activity'
  | 'uw_activity'
  | 'pipeline_stage'
  | 'loan_amount'
  | 'estimated_closing_date'
  | 'interest_rate'
  | 'ltv'

export type SortDir = 'asc' | 'desc'

export type GroupField =
  | 'none'
  | 'pipeline_stage'
  | 'loan_officer'
  | 'loan_processor'
  | 'loan_type'
  | 'cash_out'
  | 'rate_locked'
  | 'amount_bucket'
  | 'closing_month'

/**
 * Filter values are kept as raw URL-safe strings (or arrays of strings)
 * and interpreted by `applyView` based on the dimension's filter kind.
 */
export type FilterValues = {
  pipeline_stage?: string[]
  loan_officer?: string[]
  loan_processor?: string[]
  loan_type?: string[]
  loan_status?: string[]
  cash_out?: 'yes' | 'no'
  rate_locked?: 'yes' | 'no'
  amount_min?: number
  amount_max?: number
  interest_min?: number
  interest_max?: number
  ltv_min?: number
  ltv_max?: number
  closing_window?: 'this_week' | 'this_month' | 'overdue' | 'no_date'
  stale?: 'true'
  borrower_query?: string
}

export interface ViewState {
  sort: SortField
  dir: SortDir
  group: GroupField
  filters: FilterValues
  view: 'list' | 'board'
}

export const DEFAULT_VIEW_STATE: ViewState = {
  sort: 'last_updated',
  dir: 'desc',
  group: 'pipeline_stage',
  filters: { loan_status: ['active'] },
  view: 'list',
}

/** Per-page override for the default sort — used by the LP/UW/LO loan
 *  lists where the default is "stalest LP (or UW) activity first". */
export interface SortDefaults {
  sort: SortField
  dir: SortDir
}

const SORT_FIELDS: ReadonlyArray<SortField> = [
  'last_updated',
  'lp_activity',
  'uw_activity',
  'pipeline_stage',
  'loan_amount',
  'estimated_closing_date',
  'interest_rate',
  'ltv',
]

const GROUP_FIELDS: ReadonlyArray<GroupField> = [
  'none',
  'pipeline_stage',
  'loan_officer',
  'loan_processor',
  'loan_type',
  'cash_out',
  'rate_locked',
  'amount_bucket',
  'closing_month',
]

function asSortField(raw: string | null, fallback: SortField): SortField {
  return SORT_FIELDS.includes(raw as SortField) ? (raw as SortField) : fallback
}

function asGroupField(raw: string | null): GroupField {
  return GROUP_FIELDS.includes(raw as GroupField) ? (raw as GroupField) : DEFAULT_VIEW_STATE.group
}

function asDir(raw: string | null, fallback: SortDir): SortDir {
  if (raw === 'asc' || raw === 'desc') return raw
  return fallback
}

function asView(raw: string | null): 'list' | 'board' {
  return raw === 'board' ? 'board' : 'list'
}

function parseMulti(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : undefined
}

function parseNumber(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export function parseViewState(params: URLSearchParams, defaults?: SortDefaults): ViewState {
  const filters: FilterValues = {}

  const stage = parseMulti(params.get('filter.stage'))
  if (stage) filters.pipeline_stage = stage

  const lo = parseMulti(params.get('filter.lo'))
  if (lo) filters.loan_officer = lo

  const lp = parseMulti(params.get('filter.lp'))
  if (lp) filters.loan_processor = lp

  const type = parseMulti(params.get('filter.type'))
  if (type) filters.loan_type = type

  const status = parseMulti(params.get('filter.status'))
  filters.loan_status = status ?? ['active']

  const cashOut = params.get('filter.cash_out')
  if (cashOut === 'yes' || cashOut === 'no') filters.cash_out = cashOut

  const rateLocked = params.get('filter.rate_locked')
  if (rateLocked === 'yes' || rateLocked === 'no') filters.rate_locked = rateLocked

  const amountMin = parseNumber(params.get('filter.amount_min'))
  if (amountMin !== undefined) filters.amount_min = amountMin

  const amountMax = parseNumber(params.get('filter.amount_max'))
  if (amountMax !== undefined) filters.amount_max = amountMax

  const interestMin = parseNumber(params.get('filter.interest_min'))
  if (interestMin !== undefined) filters.interest_min = interestMin

  const interestMax = parseNumber(params.get('filter.interest_max'))
  if (interestMax !== undefined) filters.interest_max = interestMax

  const ltvMin = parseNumber(params.get('filter.ltv_min'))
  if (ltvMin !== undefined) filters.ltv_min = ltvMin

  const ltvMax = parseNumber(params.get('filter.ltv_max'))
  if (ltvMax !== undefined) filters.ltv_max = ltvMax

  const closing = params.get('filter.closing')
  if (closing === 'this_week' || closing === 'this_month' || closing === 'overdue' || closing === 'no_date') {
    filters.closing_window = closing
  }

  if (params.get('filter.stale') === 'true') filters.stale = 'true'

  const borrowerQuery = params.get('filter.q')?.trim()
  if (borrowerQuery) filters.borrower_query = borrowerQuery

  return {
    sort: asSortField(params.get('sort'), defaults?.sort ?? DEFAULT_VIEW_STATE.sort),
    dir: asDir(params.get('dir'), defaults?.dir ?? DEFAULT_VIEW_STATE.dir),
    group: asGroupField(params.get('group')),
    filters,
    view: asView(params.get('view')),
  }
}

export function serializeViewState(state: ViewState, defaults?: SortDefaults): URLSearchParams {
  const out = new URLSearchParams()
  if (state.sort !== (defaults?.sort ?? DEFAULT_VIEW_STATE.sort)) out.set('sort', state.sort)
  if (state.dir !== (defaults?.dir ?? DEFAULT_VIEW_STATE.dir)) out.set('dir', state.dir)
  if (state.group !== DEFAULT_VIEW_STATE.group) out.set('group', state.group)
  if (state.view !== DEFAULT_VIEW_STATE.view) out.set('view', state.view)

  const f = state.filters
  if (f.pipeline_stage?.length) out.set('filter.stage', f.pipeline_stage.join(','))
  if (f.loan_officer?.length) out.set('filter.lo', f.loan_officer.join(','))
  if (f.loan_processor?.length) out.set('filter.lp', f.loan_processor.join(','))
  if (f.loan_type?.length) out.set('filter.type', f.loan_type.join(','))
  const status = f.loan_status ?? []
  const statusIsDefault = status.length === 1 && status[0] === 'active'
  if (!statusIsDefault && status.length) out.set('filter.status', status.join(','))
  if (f.cash_out) out.set('filter.cash_out', f.cash_out)
  if (f.rate_locked) out.set('filter.rate_locked', f.rate_locked)
  if (f.amount_min !== undefined) out.set('filter.amount_min', String(f.amount_min))
  if (f.amount_max !== undefined) out.set('filter.amount_max', String(f.amount_max))
  if (f.interest_min !== undefined) out.set('filter.interest_min', String(f.interest_min))
  if (f.interest_max !== undefined) out.set('filter.interest_max', String(f.interest_max))
  if (f.ltv_min !== undefined) out.set('filter.ltv_min', String(f.ltv_min))
  if (f.ltv_max !== undefined) out.set('filter.ltv_max', String(f.ltv_max))
  if (f.closing_window) out.set('filter.closing', f.closing_window)
  if (f.stale) out.set('filter.stale', 'true')
  if (f.borrower_query) out.set('filter.q', f.borrower_query)

  return out
}

export function countActiveFilters(filters: FilterValues): number {
  let n = 0
  if (filters.pipeline_stage?.length) n++
  if (filters.loan_officer?.length) n++
  if (filters.loan_processor?.length) n++
  if (filters.loan_type?.length) n++
  const status = filters.loan_status ?? []
  const statusIsDefault = status.length === 1 && status[0] === 'active'
  if (!statusIsDefault && status.length) n++
  if (filters.cash_out) n++
  if (filters.rate_locked) n++
  if (filters.amount_min !== undefined || filters.amount_max !== undefined) n++
  if (filters.interest_min !== undefined || filters.interest_max !== undefined) n++
  if (filters.ltv_min !== undefined || filters.ltv_max !== undefined) n++
  if (filters.closing_window) n++
  if (filters.stale) n++
  if (filters.borrower_query) n++
  return n
}

export function useLoanListView(defaults?: SortDefaults): {
  state: ViewState
  setState: (next: ViewState) => void
  patch: (partial: Partial<ViewState>) => void
  patchFilters: (partial: Partial<FilterValues>) => void
  clearFilters: () => void
} {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const state = useMemo(
    () => parseViewState(new URLSearchParams(params.toString()), defaults),
    [params, defaults],
  )

  const setState = useCallback((next: ViewState) => {
    const query = serializeViewState(next, defaults).toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [router, pathname, defaults])

  const patch = useCallback((partial: Partial<ViewState>) => {
    setState({ ...state, ...partial })
  }, [state, setState])

  const patchFilters = useCallback((partial: Partial<FilterValues>) => {
    setState({ ...state, filters: { ...state.filters, ...partial } })
  }, [state, setState])

  const clearFilters = useCallback(() => {
    setState({ ...state, filters: { loan_status: ['active'] } })
  }, [state, setState])

  return { state, setState, patch, patchFilters, clearFilters }
}
