// src/lib/loans/dimensions.ts
import type { SortField, GroupField } from './view-state'

export interface SortOption {
  field: SortField
  label: string
  /** When true, asc/desc toggle is shown next to this option. */
  directional: boolean
}

export const SORT_OPTIONS: SortOption[] = [
  { field: 'last_updated',           label: 'Last updated',       directional: true },
  { field: 'lp_activity',            label: 'LP activity',        directional: true },
  { field: 'uw_activity',            label: 'UW activity',        directional: true },
  { field: 'pipeline_stage',         label: 'Pipeline stage',     directional: true },
  { field: 'loan_amount',            label: 'Loan amount',        directional: true },
  { field: 'estimated_closing_date', label: 'Est. closing date',  directional: true },
  { field: 'interest_rate',          label: 'Interest rate',      directional: true },
  { field: 'ltv',                    label: 'LTV',                directional: true },
]

export interface GroupOption {
  field: GroupField
  label: string
}

export const GROUP_OPTIONS: GroupOption[] = [
  { field: 'none',           label: 'No grouping' },
  { field: 'pipeline_stage', label: 'Pipeline stage' },
  { field: 'loan_officer',   label: 'Loan officer' },
  { field: 'loan_processor', label: 'Loan processor' },
  { field: 'loan_type',      label: 'Loan type' },
  { field: 'cash_out',       label: 'Cash-out vs no' },
  { field: 'rate_locked',    label: 'Rate locked vs not' },
  { field: 'amount_bucket',  label: 'Loan amount bucket' },
  { field: 'closing_month',  label: 'Est. closing month' },
]

export interface FilterDimension {
  key:
    | 'borrower_query'
    | 'pipeline_stage'
    | 'loan_officer'
    | 'loan_processor'
    | 'loan_type'
    | 'loan_status'
    | 'cash_out'
    | 'rate_locked'
    | 'closing_window'
    | 'stale'
    | 'amount'
    | 'interest'
    | 'ltv'
  label: string
}

export const FILTER_DIMENSIONS: FilterDimension[] = [
  { key: 'borrower_query', label: 'Borrower name' },
  { key: 'pipeline_stage', label: 'Pipeline stage' },
  { key: 'loan_officer',   label: 'Loan officer' },
  { key: 'loan_processor', label: 'Loan processor' },
  { key: 'loan_type',      label: 'Loan type' },
  { key: 'loan_status',    label: 'Loan status' },
  { key: 'cash_out',       label: 'Cash-out' },
  { key: 'rate_locked',    label: 'Rate locked' },
  { key: 'closing_window', label: 'Closing date' },
  { key: 'stale',          label: 'Stale (>14d)' },
  { key: 'amount',         label: 'Loan amount range' },
  { key: 'interest',       label: 'Interest rate range' },
  { key: 'ltv',            label: 'LTV range' },
]

export const LO_HIDDEN_DIMENSIONS: ReadonlyArray<FilterDimension['key']> = [
  'loan_officer',
]

export const LO_HIDDEN_GROUPS: ReadonlyArray<GroupField> = [
  'loan_officer',
]

export interface ClosingWindowOption {
  value: NonNullable<import('./view-state').FilterValues['closing_window']>
  label: string
}

export const CLOSING_WINDOW_OPTIONS: ClosingWindowOption[] = [
  { value: 'this_week',  label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'overdue',    label: 'Overdue' },
  { value: 'no_date',    label: 'No closing date' },
]

export const LOAN_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active',    label: 'Active' },
  { value: 'on_hold',   label: 'On hold' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const AMOUNT_BUCKETS = [
  { label: 'Under $500k', test: (n: number) => n < 500_000 },
  { label: '$500k - $1M', test: (n: number) => n >= 500_000 && n < 1_000_000 },
  { label: '$1M+',        test: (n: number) => n >= 1_000_000 },
]
