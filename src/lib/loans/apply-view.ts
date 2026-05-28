// src/lib/loans/apply-view.ts
import { PIPELINE_STAGES, type Loan } from '@/lib/types'
import type { ViewState } from './view-state'
import { AMOUNT_BUCKETS } from './dimensions'

/**
 * Minimal loan shape required by `applyView`. Both `LoanWithBorrower`
 * (in loan-list-sorted) and `LoanWithMeta` (in admin-loans-client) satisfy
 * this via structural typing once we extend their joins.
 */
export interface ViewLoan extends Loan {
  borrowers?: { full_name: string | null; email: string } | null
  loan_officers?: { full_name: string | null } | null
  loan_processors?: { full_name: string | null } | null
  loan_details?: { cash_out_amount: number | null } | null
}

export interface ViewGroup<L> {
  key: string
  label: string
  loans: L[]
}

export interface ApplyViewOptions {
  lastUpdatedMap?: Record<string, string>
}

const PIPELINE_INDEX: Record<string, number> = Object.fromEntries(
  PIPELINE_STAGES.map((s, i) => [s, i]),
)

function lastUpdated(loan: ViewLoan, opts: ApplyViewOptions): number {
  const iso = opts.lastUpdatedMap?.[loan.id] ?? loan.created_at
  return new Date(iso).getTime()
}

function isThisWeek(date: Date): boolean {
  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 86_400_000)
  return date >= now && date <= weekFromNow
}

function isThisMonth(date: Date): boolean {
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function isOverdue(date: Date): boolean {
  return date.getTime() < Date.now()
}

function matchesFilters<L extends ViewLoan>(loan: L, state: ViewState, opts: ApplyViewOptions): boolean {
  const f = state.filters

  if (f.loan_status?.length) {
    if (!f.loan_status.includes(loan.loan_status ?? 'active')) return false
  }

  if (f.pipeline_stage?.length) {
    if (!loan.pipeline_stage || !f.pipeline_stage.includes(loan.pipeline_stage)) return false
  }

  if (f.loan_officer?.length) {
    if (!loan.loan_officer_id || !f.loan_officer.includes(loan.loan_officer_id)) return false
  }

  if (f.loan_processor?.length) {
    if (!loan.loan_processor_id || !f.loan_processor.includes(loan.loan_processor_id)) return false
  }

  if (f.loan_type?.length) {
    if (!loan.loan_type || !f.loan_type.includes(loan.loan_type)) return false
  }

  if (f.cash_out) {
    const has = (loan.loan_details?.cash_out_amount ?? 0) > 0
    if (f.cash_out === 'yes' && !has) return false
    if (f.cash_out === 'no' && has) return false
  }

  if (f.rate_locked) {
    const locked = loan.rate_locked_days != null && Number(loan.rate_locked_days) > 0
    if (f.rate_locked === 'yes' && !locked) return false
    if (f.rate_locked === 'no' && locked) return false
  }

  if (f.amount_min !== undefined) {
    if ((loan.loan_amount ?? 0) < f.amount_min) return false
  }
  if (f.amount_max !== undefined) {
    if ((loan.loan_amount ?? Number.POSITIVE_INFINITY) > f.amount_max) return false
  }

  if (f.interest_min !== undefined) {
    if ((loan.interest_rate ?? 0) < f.interest_min) return false
  }
  if (f.interest_max !== undefined) {
    if ((loan.interest_rate ?? Number.POSITIVE_INFINITY) > f.interest_max) return false
  }

  if (f.ltv_min !== undefined) {
    if ((loan.ltv ?? 0) < f.ltv_min) return false
  }
  if (f.ltv_max !== undefined) {
    if ((loan.ltv ?? Number.POSITIVE_INFINITY) > f.ltv_max) return false
  }

  if (f.closing_window) {
    const raw = loan.estimated_closing_date
    if (f.closing_window === 'no_date') {
      if (raw) return false
    } else {
      if (!raw) return false
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return false
      if (f.closing_window === 'this_week' && !isThisWeek(date)) return false
      if (f.closing_window === 'this_month' && !isThisMonth(date)) return false
      if (f.closing_window === 'overdue' && !isOverdue(date)) return false
    }
  }

  if (f.stale === 'true') {
    const ageMs = Date.now() - lastUpdated(loan, opts)
    if (ageMs < 14 * 86_400_000) return false
  }

  if (f.borrower_query) {
    const q = f.borrower_query.toLowerCase()
    const name = loan.borrowers?.full_name?.toLowerCase() ?? ''
    if (!name.includes(q)) return false
  }

  return true
}

function compareLoans(state: ViewState, opts: ApplyViewOptions): (a: ViewLoan, b: ViewLoan) => number {
  const dir = state.dir === 'asc' ? 1 : -1

  return (a, b) => {
    switch (state.sort) {
      case 'last_updated': {
        return (lastUpdated(a, opts) - lastUpdated(b, opts)) * dir
      }
      case 'pipeline_stage': {
        const ai = PIPELINE_INDEX[a.pipeline_stage ?? ''] ?? 999
        const bi = PIPELINE_INDEX[b.pipeline_stage ?? ''] ?? 999
        return (ai - bi) * dir
      }
      case 'loan_amount': {
        const av = a.loan_amount ?? -1
        const bv = b.loan_amount ?? -1
        return (av - bv) * dir
      }
      case 'estimated_closing_date': {
        const av = a.estimated_closing_date ? new Date(a.estimated_closing_date).getTime() : Number.MAX_SAFE_INTEGER
        const bv = b.estimated_closing_date ? new Date(b.estimated_closing_date).getTime() : Number.MAX_SAFE_INTEGER
        return (av - bv) * dir
      }
      case 'interest_rate': {
        const av = a.interest_rate ?? -1
        const bv = b.interest_rate ?? -1
        return (av - bv) * dir
      }
      case 'ltv': {
        const av = a.ltv ?? -1
        const bv = b.ltv ?? -1
        return (av - bv) * dir
      }
    }
  }
}

function groupKey(loan: ViewLoan, state: ViewState): { key: string; label: string } {
  switch (state.group) {
    case 'none':
      return { key: 'all', label: '' }
    case 'pipeline_stage': {
      const stage = loan.pipeline_stage ?? 'Unknown'
      return { key: stage, label: stage }
    }
    case 'loan_officer': {
      const name = loan.loan_officers?.full_name?.trim() || 'Unassigned'
      return { key: name.toLowerCase(), label: name }
    }
    case 'loan_processor': {
      const name = loan.loan_processors?.full_name?.trim() || 'Unassigned'
      return { key: name.toLowerCase(), label: name }
    }
    case 'loan_type': {
      const t = loan.loan_type ?? 'Unknown'
      return { key: t, label: t }
    }
    case 'cash_out': {
      const has = (loan.loan_details?.cash_out_amount ?? 0) > 0
      return has ? { key: 'yes', label: 'Cash-out' } : { key: 'no', label: 'No cash-out' }
    }
    case 'rate_locked': {
      const locked = loan.rate_locked_days != null && Number(loan.rate_locked_days) > 0
      return locked ? { key: 'yes', label: 'Rate locked' } : { key: 'no', label: 'Not locked' }
    }
    case 'amount_bucket': {
      const amount = loan.loan_amount ?? 0
      const bucket = AMOUNT_BUCKETS.find(b => b.test(amount)) ?? AMOUNT_BUCKETS[0]
      return { key: bucket.label, label: bucket.label }
    }
    case 'closing_month': {
      if (!loan.estimated_closing_date) return { key: 'no_date', label: 'No closing date' }
      const d = new Date(loan.estimated_closing_date)
      if (Number.isNaN(d.getTime())) return { key: 'no_date', label: 'No closing date' }
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      return { key: label, label }
    }
  }
}

function compareGroups(group: ViewState['group']): (a: ViewGroup<ViewLoan>, b: ViewGroup<ViewLoan>) => number {
  return (a, b) => {
    if (group === 'pipeline_stage') {
      const ai = PIPELINE_INDEX[a.key] ?? 999
      const bi = PIPELINE_INDEX[b.key] ?? 999
      return ai - bi
    }
    const aTrailing = /unassigned|no_date|no closing|no cash-out|not locked/i.test(a.label)
    const bTrailing = /unassigned|no_date|no closing|no cash-out|not locked/i.test(b.label)
    if (aTrailing && !bTrailing) return 1
    if (!aTrailing && bTrailing) return -1
    return a.label.localeCompare(b.label)
  }
}

export function applyView<L extends ViewLoan>(
  loans: L[],
  state: ViewState,
  opts: ApplyViewOptions = {},
): ViewGroup<L>[] {
  const filtered = loans.filter(l => matchesFilters(l, state, opts))
  const sorted = filtered.sort(compareLoans(state, opts) as (a: L, b: L) => number)

  if (state.group === 'none') {
    return [{ key: 'all', label: '', loans: sorted }]
  }

  const buckets = new Map<string, ViewGroup<L>>()
  for (const loan of sorted) {
    const { key, label } = groupKey(loan, state)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { key, label, loans: [] }
      buckets.set(key, bucket)
    }
    bucket.loans.push(loan)
  }

  return [...buckets.values()].sort(
    compareGroups(state.group) as (a: ViewGroup<L>, b: ViewGroup<L>) => number,
  )
}
