'use client'

import { ArrowDown, ArrowUp, ChevronDown, LayoutGrid, LayoutList, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { PIPELINE_STAGES } from '@/lib/types'
import {
  SORT_OPTIONS,
  GROUP_OPTIONS,
  FILTER_DIMENSIONS,
  CLOSING_WINDOW_OPTIONS,
  LOAN_STATUS_OPTIONS,
  LO_HIDDEN_DIMENSIONS,
  LO_HIDDEN_GROUPS,
  type FilterDimension,
} from '@/lib/loans/dimensions'
import {
  countActiveFilters,
  type FilterValues,
  type GroupField,
  type SortField,
  type ViewState,
} from '@/lib/loans/view-state'

interface PersonOption {
  id: string
  name: string
}

interface Props {
  state: ViewState
  onSortChange: (sort: SortField, dir: ViewState['dir']) => void
  onGroupChange: (group: GroupField) => void
  onFiltersChange: (next: Partial<FilterValues>) => void
  onClearFilters: () => void
  onViewChange: (view: ViewState['view']) => void
  loanOfficers?: PersonOption[]
  loanProcessors?: PersonOption[]
  loanTypes?: string[]
  hideLoanOfficerDimensions?: boolean
  hideViewToggle?: boolean
}

function isHidden(dim: FilterDimension, hideLO: boolean): boolean {
  return hideLO && (LO_HIDDEN_DIMENSIONS as string[]).includes(dim.key)
}

function toggleInArray(arr: string[] | undefined, value: string): string[] {
  const set = new Set(arr ?? [])
  if (set.has(value)) set.delete(value); else set.add(value)
  return [...set]
}

function activeSortLabel(sort: SortField): string {
  return SORT_OPTIONS.find(o => o.field === sort)?.label ?? 'Sort'
}

function activeGroupLabel(group: GroupField): string {
  return GROUP_OPTIONS.find(o => o.field === group)?.label ?? 'Group'
}

export function LoanListToolbar({
  state,
  onSortChange,
  onGroupChange,
  onFiltersChange,
  onClearFilters,
  onViewChange,
  loanOfficers = [],
  loanProcessors = [],
  loanTypes = [],
  hideLoanOfficerDimensions = false,
  hideViewToggle = false,
}: Props) {
  const activeFilterCount = countActiveFilters(state.filters)
  const filterDimensions = FILTER_DIMENSIONS.filter(d => !isHidden(d, hideLoanOfficerDimensions))
  const groupOptions = GROUP_OPTIONS.filter(
    g => !(hideLoanOfficerDimensions && (LO_HIDDEN_GROUPS as string[]).includes(g.field)),
  )

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Sort popover */}
      <Popover>
        <PopoverTrigger
          type="button"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:border-gray-400 transition-colors text-gray-700"
        >
          <span className="text-gray-500">Sort:</span>
          <span className="font-medium">{activeSortLabel(state.sort)}</span>
          {state.dir === 'desc'
            ? <ArrowDown className="w-3 h-3 text-gray-400" />
            : <ArrowUp className="w-3 h-3 text-gray-400" />}
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          {SORT_OPTIONS.map(opt => {
            const active = state.sort === opt.field
            return (
              <button
                key={opt.field}
                type="button"
                onClick={() => onSortChange(opt.field, state.dir)}
                className={`w-full text-left flex items-center justify-between text-sm px-2.5 py-1.5 rounded hover:bg-gray-50 ${
                  active ? 'text-primary font-medium' : 'text-gray-700'
                }`}
              >
                <span>{opt.label}</span>
                {active && (
                  <span className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onSortChange(opt.field, 'asc') }}
                      aria-label="Sort ascending"
                      className={`p-0.5 rounded ${state.dir === 'asc' ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onSortChange(opt.field, 'desc') }}
                      aria-label="Sort descending"
                      className={`p-0.5 rounded ${state.dir === 'desc' ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>

      {/* Filter popover */}
      <Popover>
        <PopoverTrigger
          type="button"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:border-gray-400 transition-colors text-gray-700"
        >
          <span className="font-medium">Filter</span>
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] font-semibold">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Filters</h4>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={onClearFilters}
                className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          <div className="space-y-3">
            {filterDimensions.map(dim => (
              <FilterSection
                key={dim.key}
                dim={dim}
                state={state}
                onFiltersChange={onFiltersChange}
                loanOfficers={loanOfficers}
                loanProcessors={loanProcessors}
                loanTypes={loanTypes}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Group popover */}
      <Popover>
        <PopoverTrigger
          type="button"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:border-gray-400 transition-colors text-gray-700"
        >
          <span className="text-gray-500">Group:</span>
          <span className="font-medium">{activeGroupLabel(state.group)}</span>
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          {groupOptions.map(opt => (
            <button
              key={opt.field}
              type="button"
              onClick={() => onGroupChange(opt.field)}
              className={`w-full text-left text-sm px-2.5 py-1.5 rounded hover:bg-gray-50 ${
                state.group === opt.field ? 'text-primary font-medium' : 'text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* List / Board view toggle */}
      {!hideViewToggle && (
        <div className="ml-auto flex border border-gray-300 rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => onViewChange('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
              state.view === 'list' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" /> List
          </button>
          <button
            type="button"
            onClick={() => onViewChange('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${
              state.view === 'board' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Board
          </button>
        </div>
      )}
    </div>
  )
}

interface FilterSectionProps {
  dim: FilterDimension
  state: ViewState
  onFiltersChange: (next: Partial<FilterValues>) => void
  loanOfficers: PersonOption[]
  loanProcessors: PersonOption[]
  loanTypes: string[]
}

function FilterSection({ dim, state, onFiltersChange, loanOfficers, loanProcessors, loanTypes }: FilterSectionProps) {
  const f = state.filters
  const labelClass = 'text-xs font-medium text-gray-600 mb-1'

  switch (dim.key) {
    case 'borrower_query':
      return (
        <div>
          <div className={labelClass}>{dim.label}</div>
          <Input
            placeholder="Search borrower..."
            value={f.borrower_query ?? ''}
            onChange={e => onFiltersChange({ borrower_query: e.target.value || undefined })}
            className="h-8 text-sm"
          />
        </div>
      )
    case 'pipeline_stage':
      return (
        <CheckboxGroup
          label={dim.label}
          options={PIPELINE_STAGES.map(s => ({ value: s as string, label: s as string }))}
          selected={f.pipeline_stage ?? []}
          onChange={vals => onFiltersChange({ pipeline_stage: vals.length ? vals : undefined })}
        />
      )
    case 'loan_officer':
      return (
        <CheckboxGroup
          label={dim.label}
          options={loanOfficers.map(p => ({ value: p.id, label: p.name }))}
          selected={f.loan_officer ?? []}
          onChange={vals => onFiltersChange({ loan_officer: vals.length ? vals : undefined })}
        />
      )
    case 'loan_processor':
      return (
        <CheckboxGroup
          label={dim.label}
          options={loanProcessors.map(p => ({ value: p.id, label: p.name }))}
          selected={f.loan_processor ?? []}
          onChange={vals => onFiltersChange({ loan_processor: vals.length ? vals : undefined })}
        />
      )
    case 'loan_type':
      return (
        <CheckboxGroup
          label={dim.label}
          options={loanTypes.map(t => ({ value: t, label: t }))}
          selected={f.loan_type ?? []}
          onChange={vals => onFiltersChange({ loan_type: vals.length ? vals : undefined })}
        />
      )
    case 'loan_status':
      return (
        <CheckboxGroup
          label={dim.label}
          options={LOAN_STATUS_OPTIONS}
          selected={f.loan_status ?? ['active']}
          onChange={vals => onFiltersChange({ loan_status: vals.length ? vals : ['active'] })}
        />
      )
    case 'cash_out':
      return (
        <TriState
          label={dim.label}
          value={f.cash_out}
          onChange={v => onFiltersChange({ cash_out: v })}
          yesLabel="Cash-out"
          noLabel="No cash-out"
        />
      )
    case 'rate_locked':
      return (
        <TriState
          label={dim.label}
          value={f.rate_locked}
          onChange={v => onFiltersChange({ rate_locked: v })}
          yesLabel="Locked"
          noLabel="Not locked"
        />
      )
    case 'closing_window':
      return (
        <div>
          <div className={labelClass}>{dim.label}</div>
          <div className="flex flex-wrap gap-1">
            {CLOSING_WINDOW_OPTIONS.map(opt => {
              const active = f.closing_window === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onFiltersChange({ closing_window: active ? undefined : opt.value })}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )
    case 'stale':
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <Checkbox
            checked={f.stale === 'true'}
            onCheckedChange={c => onFiltersChange({ stale: c ? 'true' : undefined })}
          />
          Stale (no activity in 14+ days)
        </label>
      )
    case 'amount':
      return (
        <NumericRange
          label={dim.label}
          min={f.amount_min}
          max={f.amount_max}
          onChange={(mn, mx) => onFiltersChange({ amount_min: mn, amount_max: mx })}
          placeholderMin="0"
          placeholderMax="No max"
        />
      )
    case 'interest':
      return (
        <NumericRange
          label={dim.label}
          min={f.interest_min}
          max={f.interest_max}
          onChange={(mn, mx) => onFiltersChange({ interest_min: mn, interest_max: mx })}
          placeholderMin="0%"
          placeholderMax="No max"
        />
      )
    case 'ltv':
      return (
        <NumericRange
          label={dim.label}
          min={f.ltv_min}
          max={f.ltv_max}
          onChange={(mn, mx) => onFiltersChange({ ltv_min: mn, ltv_max: mx })}
          placeholderMin="0%"
          placeholderMax="100%"
        />
      )
  }
}

function CheckboxGroup({ label, options, selected, onChange }: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (vals: string[]) => void
}) {
  if (options.length === 0) return null
  return (
    <div>
      <div className="text-xs font-medium text-gray-600 mb-1">{label}</div>
      <div className="space-y-0.5">
        {options.map(opt => (
          <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
            <Checkbox
              checked={selected.includes(opt.value)}
              onCheckedChange={() => onChange(toggleInArray(selected, opt.value))}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  )
}

function TriState({ label, value, onChange, yesLabel, noLabel }: {
  label: string
  value: 'yes' | 'no' | undefined
  onChange: (v: 'yes' | 'no' | undefined) => void
  yesLabel: string
  noLabel: string
}) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-600 mb-1">{label}</div>
      <div className="flex gap-1">
        {[
          { v: undefined as 'yes' | 'no' | undefined, label: 'Either' },
          { v: 'yes' as 'yes' | 'no' | undefined, label: yesLabel },
          { v: 'no' as 'yes' | 'no' | undefined, label: noLabel },
        ].map(opt => {
          const active = value === opt.v
          return (
            <button
              key={String(opt.v)}
              type="button"
              onClick={() => onChange(opt.v)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NumericRange({ label, min, max, onChange, placeholderMin, placeholderMax }: {
  label: string
  min: number | undefined
  max: number | undefined
  onChange: (min: number | undefined, max: number | undefined) => void
  placeholderMin: string
  placeholderMax: string
}) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-600 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          placeholder={placeholderMin}
          value={min ?? ''}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value), max)}
          className="h-8 text-sm"
        />
        <span className="text-xs text-gray-400">to</span>
        <Input
          type="number"
          placeholder={placeholderMax}
          value={max ?? ''}
          onChange={e => onChange(min, e.target.value === '' ? undefined : Number(e.target.value))}
          className="h-8 text-sm"
        />
      </div>
    </div>
  )
}
