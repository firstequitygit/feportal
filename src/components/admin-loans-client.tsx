// src/components/admin-loans-client.tsx
'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Archive } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { type Loan, type PipelineStage } from '@/lib/types'
import { LoanListToolbar } from '@/components/loans/loan-list-toolbar'
import { useLoanListView } from '@/lib/loans/view-state'
import { applyView, type ViewGroup, type ViewLoan } from '@/lib/loans/apply-view'

export type LoanWithMeta = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
  loan_officers?: { id: string; full_name: string | null } | null
  loan_processors?: { id: string; full_name: string | null } | null
  loan_details?: { cash_out_amount: number | null } | null
  outstandingCount: number
  pendingReviewCount: number
  totalConditionsCount: number
}

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val)
}

function formatStage(stage: string | null): string {
  if (!stage) return '—'
  return stage.split(' /')[0].trim()
}

function stageColor(stage: PipelineStage | string | null): string {
  switch (stage) {
    case 'New Application':          return 'bg-gray-100 text-gray-700'
    case 'Processing':               return 'bg-blue-100 text-blue-700'
    case 'Pre-Underwriting':         return 'bg-yellow-100 text-yellow-700'
    case 'Underwriting':             return 'bg-orange-100 text-orange-700'
    case 'Conditionally Approved':   return 'bg-teal-100 text-teal-700'
    case 'Approved':                 return 'bg-green-100 text-green-700'
    case 'Closed':                   return 'bg-purple-100 text-purple-700'
    default:                         return 'bg-gray-100 text-gray-600'
  }
}

function uniquePeople(
  loans: LoanWithMeta[],
  picker: (l: LoanWithMeta) => { id: string; name: string } | null,
) {
  const map = new Map<string, { id: string; name: string }>()
  for (const l of loans) {
    const p = picker(l)
    if (p && !map.has(p.id)) map.set(p.id, p)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function AdminLoansClient({ loans }: { loans: LoanWithMeta[] }) {
  const { state, patch, patchFilters, clearFilters } = useLoanListView()
  const archivedCount = loans.filter(l => l.archived).length

  const visibleLoans = useMemo(() => loans.filter(l => !l.archived), [loans])

  const loanOfficers = useMemo(
    () =>
      uniquePeople(visibleLoans, l =>
        l.loan_officers && l.loan_officer_id
          ? { id: l.loan_officer_id, name: l.loan_officers.full_name ?? 'Unnamed' }
          : null,
      ),
    [visibleLoans],
  )
  const loanProcessors = useMemo(
    () =>
      uniquePeople(visibleLoans, l =>
        l.loan_processors && l.loan_processor_id
          ? { id: l.loan_processor_id, name: l.loan_processors.full_name ?? 'Unnamed' }
          : null,
      ),
    [visibleLoans],
  )
  const loanTypes = useMemo(
    () =>
      [...new Set(
        visibleLoans.map(l => l.loan_type).filter((t): t is NonNullable<typeof t> => !!t),
      )].sort(),
    [visibleLoans],
  )

  const groups = useMemo(
    () =>
      applyView(visibleLoans as unknown as ViewLoan[], state) as unknown as ViewGroup<LoanWithMeta>[],
    [visibleLoans, state],
  )

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <LoanListToolbar
          state={state}
          onSortChange={(sort, dir) => patch({ sort, dir })}
          onGroupChange={group => patch({ group })}
          onFiltersChange={partial => patchFilters(partial)}
          onClearFilters={clearFilters}
          onViewChange={() => { /* admin stays in table view */ }}
          loanOfficers={loanOfficers}
          loanProcessors={loanProcessors}
          loanTypes={loanTypes}
          hideViewToggle
        />

        {archivedCount > 0 && (
          <Link
            href="/admin/archived"
            className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-500 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors whitespace-nowrap"
          >
            <Archive className="w-3.5 h-3.5" />
            Archived ({archivedCount})
          </Link>
        )}
      </div>

      <TableView groups={groups} />
    </div>
  )
}

function TableView({ groups }: { groups: ViewGroup<LoanWithMeta>[] }) {
  const total = groups.reduce((n, g) => n + g.loans.length, 0)
  if (total === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          No loans match the current filters.
        </CardContent>
      </Card>
    )
  }

  const showGroupHeaders = groups.length > 1 || (groups.length === 1 && !!groups[0].label)

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-3 pr-4 font-medium">Property</th>
                <th className="pb-3 pr-4 font-medium">Borrower</th>
                <th className="pb-3 pr-4 font-medium">Type</th>
                <th className="pb-3 pr-4 font-medium">Amount</th>
                <th className="pb-3 pr-4 font-medium">Stage</th>
                <th className="pb-3 pr-4 font-medium">Conditions</th>
                <th className="pb-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map(group => (
                <RenderGroup key={group.key} group={group} showHeader={showGroupHeaders} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function RenderGroup({ group, showHeader }: { group: ViewGroup<LoanWithMeta>; showHeader: boolean }) {
  return (
    <>
      {showHeader && (
        <tr>
          <td colSpan={7} className="bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            {group.label} <span className="text-gray-300">·</span> {group.loans.length}
          </td>
        </tr>
      )}
      {group.loans.map(loan => (
        <tr key={loan.id} className="hover:bg-gray-50">
          <td className="py-3 font-medium text-gray-900 max-w-[200px] truncate pr-4">
            {loan.property_address ?? '—'}
          </td>
          <td className="py-3 text-gray-600 pr-4">
            {loan.borrowers?.full_name ?? <span className="text-gray-400 italic">Unassigned</span>}
          </td>
          <td className="py-3 text-gray-600 pr-4">{loan.loan_type ?? '—'}</td>
          <td className="py-3 text-gray-600 pr-4 whitespace-nowrap">{formatCurrency(loan.loan_amount)}</td>
          <td className="py-3 pr-4">
            <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${stageColor(loan.pipeline_stage)}`}>
              {formatStage(loan.pipeline_stage)}
            </span>
          </td>
          <td className="py-3 pr-4">
            {loan.outstandingCount > 0 ? (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full whitespace-nowrap">
                {loan.outstandingCount} outstanding
              </span>
            ) : loan.pendingReviewCount > 0 ? (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full whitespace-nowrap">
                {loan.pendingReviewCount} pending review
              </span>
            ) : loan.totalConditionsCount > 0 ? (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full whitespace-nowrap">
                All Satisfied
              </span>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </td>
          <td className="py-3">
            <Link href={`/admin/loans/${loan.id}`} className="text-primary hover:opacity-80 text-xs whitespace-nowrap">
              Manage →
            </Link>
          </td>
        </tr>
      ))}
    </>
  )
}
