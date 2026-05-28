// src/components/loan-list-sorted.tsx
'use client'

import { useMemo, useState } from 'react'
import { FileX } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { type Loan, type OutstandingCounts, PIPELINE_STAGES } from '@/lib/types'
import { LoanCard } from '@/components/loans/loan-card'
import { GroupHeader } from '@/components/loans/group-header'
import { LoanListToolbar } from '@/components/loans/loan-list-toolbar'
import { useLoanListView } from '@/lib/loans/view-state'
import { applyView, type ViewLoan } from '@/lib/loans/apply-view'

const ZERO_COUNTS: OutstandingCounts = { you: 0, borrower: 0, team: 0, total: 0 }
const BOARD_STAGES = PIPELINE_STAGES.slice(0, 6) // exclude 'Closed'

export type LoanWithBorrower = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
  loan_officers?: { id: string; full_name: string | null } | null
  loan_processors?: { id: string; full_name: string | null } | null
  loan_details?: { cash_out_amount: number | null } | null
}

interface Props {
  /** All non-closed loans (active, on_hold, cancelled). */
  activeLoans: LoanWithBorrower[]
  closedLoans: LoanWithBorrower[]
  outstandingMap: Record<string, OutstandingCounts>
  lastUpdatedMap: Record<string, string>
  linkPrefix: string
  /**
   * When true, hides Loan-officer filter / group dimensions in the toolbar.
   * Used by the LO role page where the dimension is degenerate.
   */
  hideLoanOfficerDimensions?: boolean
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
  if (!stage) return 'Unknown'
  return stage.split(' /')[0].trim()
}

function uniquePeople(
  loans: LoanWithBorrower[],
  picker: (l: LoanWithBorrower) => { id: string; name: string } | null,
) {
  const map = new Map<string, { id: string; name: string }>()
  for (const l of loans) {
    const p = picker(l)
    if (p && !map.has(p.id)) map.set(p.id, p)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function LoanListSorted({
  activeLoans,
  closedLoans,
  outstandingMap,
  lastUpdatedMap,
  linkPrefix,
  hideLoanOfficerDimensions = false,
}: Props) {
  const { state, patch, patchFilters, clearFilters } = useLoanListView()

  const allLoans = useMemo<LoanWithBorrower[]>(
    () => [...activeLoans, ...closedLoans],
    [activeLoans, closedLoans],
  )

  const loanOfficers = useMemo(
    () =>
      uniquePeople(allLoans, l =>
        l.loan_officers && l.loan_officer_id
          ? { id: l.loan_officer_id, name: l.loan_officers.full_name ?? 'Unnamed' }
          : null,
      ),
    [allLoans],
  )
  const loanProcessors = useMemo(
    () =>
      uniquePeople(allLoans, l =>
        l.loan_processors && l.loan_processor_id
          ? { id: l.loan_processor_id, name: l.loan_processors.full_name ?? 'Unnamed' }
          : null,
      ),
    [allLoans],
  )
  const loanTypes = useMemo(
    () =>
      [...new Set(
        allLoans.map(l => l.loan_type).filter((t): t is NonNullable<typeof t> => !!t),
      )].sort(),
    [allLoans],
  )

  const groups = useMemo(
    () => applyView(allLoans as ViewLoan[], state, { lastUpdatedMap }) as ReturnType<typeof applyView<LoanWithBorrower>>,
    [allLoans, state, lastUpdatedMap],
  )

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  const total = allLoans.length
  if (total === 0) {
    return (
      <Card className="border border-gray-200">
        <CardContent className="py-16 flex flex-col items-center gap-3">
          <FileX className="w-10 h-10 text-gray-300" />
          <div className="text-center">
            <p className="text-gray-600 font-medium">No loans assigned yet</p>
            <p className="text-gray-400 text-sm mt-1">Loans assigned to you will appear here.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const filteredTotal = groups.reduce((acc, g) => acc + g.loans.length, 0)

  return (
    <div className="space-y-5">
      <LoanListToolbar
        state={state}
        onSortChange={(sort, dir) => patch({ sort, dir })}
        onGroupChange={group => patch({ group })}
        onFiltersChange={partial => patchFilters(partial)}
        onClearFilters={clearFilters}
        onViewChange={view => patch({ view })}
        loanOfficers={loanOfficers}
        loanProcessors={loanProcessors}
        loanTypes={loanTypes}
        hideLoanOfficerDimensions={hideLoanOfficerDimensions}
      />

      {state.view === 'board' && (
        <BoardView loans={groups.flatMap(g => g.loans)} linkPrefix={linkPrefix} />
      )}

      {state.view === 'list' && (
        <>
          {filteredTotal === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-gray-500 text-sm">
                No loans match the current filters.
              </CardContent>
            </Card>
          )}

          {state.group === 'none' ? (
            <div className="space-y-2">
              {groups[0]?.loans.map(loan => (
                <LoanCard
                  key={loan.id}
                  loan={loan}
                  outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                  linkPrefix={linkPrefix}
                />
              ))}
            </div>
          ) : (
            groups.map(group => {
              const isCollapsed = collapsed.has(group.key)
              return (
                <section key={group.key}>
                  <GroupHeader
                    label={group.label}
                    count={group.loans.length}
                    collapsed={isCollapsed}
                    onToggle={() => toggleGroup(group.key)}
                  />
                  {!isCollapsed && (
                    <div className="space-y-1.5">
                      {group.loans.map(loan => (
                        <LoanCard
                          key={loan.id}
                          loan={loan}
                          outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                          linkPrefix={linkPrefix}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })
          )}
        </>
      )}
    </div>
  )
}

function BoardView({ loans, linkPrefix }: { loans: LoanWithBorrower[]; linkPrefix: string }) {
  const columns = BOARD_STAGES.map(stage => ({
    stage,
    loans: loans.filter(l => l.pipeline_stage === stage),
  }))

  return (
    <div className="pb-4">
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x -mx-2 px-2">
        {columns.map(({ stage, loans: stageLoans }) => (
          <div key={stage} className="w-70 shrink-0 snap-start">
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate">
                {formatStage(stage)}
              </h3>
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full ml-2 shrink-0">
                {stageLoans.length}
              </span>
            </div>
            <div className="space-y-2">
              {stageLoans.map(loan => (
                <Link key={loan.id} href={`${linkPrefix}/loans/${loan.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="p-3">
                      <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
                        {loan.property_address ?? '—'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {loan.borrowers?.full_name ?? <span className="italic">Unassigned</span>}
                      </p>
                      <div className="flex items-center justify-between mt-2 gap-1 flex-wrap">
                        <span className="text-xs text-gray-500">{loan.loan_type ?? '—'}</span>
                        <span className="text-xs font-medium text-gray-900 whitespace-nowrap">
                          {formatCurrency(loan.loan_amount)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {stageLoans.length === 0 && (
                <div className="border-2 border-dashed border-gray-200 rounded-lg h-16 flex items-center justify-center">
                  <p className="text-xs text-gray-400">Empty</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
