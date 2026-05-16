'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ChevronDown, MapPin, FileX, LayoutList, LayoutGrid } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { type Loan, type PipelineStage, type OutstandingCounts, PIPELINE_STAGES } from '@/lib/types'
import { formatDate } from '@/lib/format-date'

const ZERO_COUNTS: OutstandingCounts = { you: 0, borrower: 0, team: 0, total: 0 }

const BOARD_STAGES = PIPELINE_STAGES.slice(0, 5) // New Application → Submitted

type LoanWithBorrower = Loan & { borrowers?: { full_name: string | null; email: string } | null }

interface Props {
  activeLoans: LoanWithBorrower[]
  closedLoans: LoanWithBorrower[]
  outstandingMap: Record<string, OutstandingCounts>
  lastUpdatedMap: Record<string, string>   // loan_id → ISO timestamp of most recent event
  linkPrefix: string                        // e.g. '/loan-officer' or '/loan-processor'
}

type SortBy = 'last_updated' | 'stage'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return 'No activity'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diffMs / 60_000)
  const hours = Math.floor(diffMs / 3_600_000)
  const days  = Math.floor(diffMs / 86_400_000)
  const weeks = Math.floor(days / 7)
  if (mins  <  1) return 'Just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  <  7) return `${days}d ago`
  if (weeks <  5) return `${weeks}w ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function stageBadgeColor(stage: PipelineStage | null): string {
  switch (stage) {
    case 'New Application':  return 'bg-gray-100 text-gray-700'
    case 'Processing':       return 'bg-blue-100 text-blue-700'
    case 'Pre-Underwriting': return 'bg-yellow-100 text-yellow-700'
    case 'Underwriting':     return 'bg-orange-100 text-orange-700'
    case 'Submitted':        return 'bg-green-100 text-green-700'
    case 'Closed':           return 'bg-purple-100 text-purple-700'
    default:                        return 'bg-gray-100 text-gray-600'
  }
}

function formatStage(stage: PipelineStage | string | null): string {
  if (!stage) return 'Unknown'
  return stage.split(' /')[0].trim()
}

function sortLoans(loans: LoanWithBorrower[], sortBy: SortBy, lastUpdatedMap: Record<string, string>): LoanWithBorrower[] {
  return [...loans].sort((a, b) => {
    if (sortBy === 'stage') {
      const ai = PIPELINE_STAGES.indexOf(a.pipeline_stage as PipelineStage)
      const bi = PIPELINE_STAGES.indexOf(b.pipeline_stage as PipelineStage)
      if (ai !== bi) return ai - bi
    }
    const aTime = new Date(lastUpdatedMap[a.id] ?? a.created_at).getTime()
    const bTime = new Date(lastUpdatedMap[b.id] ?? b.created_at).getTime()
    return bTime - aTime
  })
}

function LoanCard({ loan, outstanding, lastUpdated, linkPrefix }: {
  loan: LoanWithBorrower
  outstanding: OutstandingCounts
  lastUpdated: string | undefined
  linkPrefix: string
}) {
  const isClosed = loan.pipeline_stage === 'Closed'
  const accentClass = isClosed
    ? 'border-l-gray-300'
    : outstanding.you > 0
      ? 'border-l-red-400'
      : outstanding.total > 0
        ? 'border-l-amber-300'
        : 'border-l-green-400'

  return (
    <Link href={`${linkPrefix}/loans/${loan.id}`} className="block group">
      <Card className={`border border-gray-200 border-l-4 ${accentClass} transition-all duration-150 group-hover:shadow-md group-hover:border-gray-300 ${isClosed ? 'opacity-70' : ''}`}>
        <CardContent className="p-5">
          {/* Top row: address + badges + chevron */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-px" />
                <p className="font-semibold text-gray-900 truncate">
                  {loan.property_address ?? 'Address not set'}
                </p>
              </div>
              <p className="text-sm text-gray-500 mt-1 ml-5 truncate">
                {loan.borrowers?.full_name ?? 'No borrower assigned'}
                {loan.loan_type ? <span className="text-gray-300"> · </span> : null}
                {loan.loan_type}
                <span className="text-gray-300"> · </span>
                {formatCurrency(loan.loan_amount)}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              {outstanding.you > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                  You {outstanding.you}
                </span>
              )}
              {outstanding.borrower > 0 && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
                  Borrower {outstanding.borrower}
                </span>
              )}
              {outstanding.team > 0 && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                  Team {outstanding.team}
                </span>
              )}
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${stageBadgeColor(loan.pipeline_stage)}`}>
                {isClosed ? 'Closed' : formatStage(loan.pipeline_stage)}
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-2">
            <div>
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">Interest Rate</p>
              <p className="font-semibold text-gray-800 text-sm mt-0.5">{loan.interest_rate ? `${loan.interest_rate}%` : '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">Rate Locked / Days</p>
              <p className="font-semibold text-gray-800 text-sm mt-0.5">{loan.rate_locked_days ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">Last Updated</p>
              <p className="font-semibold text-gray-800 text-sm mt-0.5">{formatDate(lastUpdated ?? loan.created_at)}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">Term</p>
              <p className="font-semibold text-gray-800 text-sm mt-0.5">{loan.term_months ? `${loan.term_months} mo` : '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">Est. Closing Date</p>
              <p className="font-semibold text-gray-800 text-sm mt-0.5">{formatDate(loan.estimated_closing_date)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function BoardView({ activeLoans, outstandingMap, lastUpdatedMap, linkPrefix }: {
  activeLoans: LoanWithBorrower[]
  outstandingMap: Record<string, OutstandingCounts>
  lastUpdatedMap: Record<string, string>
  linkPrefix: string
}) {
  const columns = BOARD_STAGES.map(stage => ({
    stage,
    loans: activeLoans
      .filter(l => l.pipeline_stage === stage)
      .sort((a, b) => {
        const aTime = new Date(lastUpdatedMap[a.id] ?? a.created_at).getTime()
        const bTime = new Date(lastUpdatedMap[b.id] ?? b.created_at).getTime()
        return bTime - aTime // most recent first
      }),
  }))

  return (
    <div className="pb-4 overflow-x-auto">
      <div className="grid grid-cols-5 gap-3 min-w-[720px]">
        {columns.map(({ stage, loans: stageLoans }) => (
          <div key={stage} className="min-w-0">
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate">
                {formatStage(stage)}
              </h3>
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full ml-2 shrink-0">
                {stageLoans.length}
              </span>
            </div>
            <div className="space-y-2">
              {stageLoans.map(loan => {
                const outstanding = outstandingMap[loan.id] ?? ZERO_COUNTS
                return (
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
                        {outstanding.you > 0 && (
                          <div className="mt-2">
                            <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-semibold">
                              You {outstanding.you}
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
                          {formatRelative(lastUpdatedMap[loan.id])}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
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

export function LoanListSorted({ activeLoans, closedLoans, outstandingMap, lastUpdatedMap, linkPrefix }: Props) {
  const [sortBy, setSortBy] = useState<SortBy>('stage')
  const [view, setView] = useState<'list' | 'board'>('list')
  const [stageFilter, setStageFilter] = useState<PipelineStage | 'all'>('all')
  const [closedExpanded, setClosedExpanded] = useState(false)

  // Stages that actually have loans
  const activeStages = PIPELINE_STAGES.filter(s => activeLoans.some(l => l.pipeline_stage === s))

  const filteredActive = stageFilter === 'all'
    ? activeLoans
    : activeLoans.filter(l => l.pipeline_stage === stageFilter)

  const sortedActive = sortLoans(filteredActive, sortBy, lastUpdatedMap)
  const sortedClosed = sortLoans(closedLoans, sortBy, lastUpdatedMap)
  const total = activeLoans.length + closedLoans.length

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

  return (
    <div className="space-y-6">
      {/* Top controls row: sort (list only) + view toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {view === 'list' && (
          <>
            <span className="text-sm text-gray-500">Sort by:</span>
            {(['last_updated', 'stage'] as SortBy[]).map(opt => (
              <button
                key={opt}
                onClick={() => setSortBy(opt)}
                className={`text-sm px-3 py-1 rounded-full border transition-colors ${
                  sortBy === opt
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {opt === 'last_updated' ? 'Last Updated' : 'Stage'}
              </button>
            ))}
          </>
        )}
        <div className="ml-auto flex border border-gray-300 rounded-md overflow-hidden">
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
              view === 'list' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" /> List
          </button>
          <button
            onClick={() => setView('board')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-l border-gray-300 transition-colors ${
              view === 'board' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Board
          </button>
        </div>
      </div>

      {/* Stage filter pills — only shown when there are multiple stages */}
      {activeStages.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setStageFilter('all')}
            className={`text-sm px-3 py-1 rounded-full border transition-colors ${
              stageFilter === 'all'
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            All stages
          </button>
          {activeStages.map(stage => (
            <button
              key={stage}
              onClick={() => setStageFilter(stageFilter === stage ? 'all' : stage)}
              className={`text-sm px-3 py-1 rounded-full border transition-colors ${
                stageFilter === stage
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {formatStage(stage)}
            </button>
          ))}
        </div>
      )}

      {view === 'board' && (
        <BoardView activeLoans={filteredActive} outstandingMap={outstandingMap} lastUpdatedMap={lastUpdatedMap} linkPrefix={linkPrefix} />
      )}

      {view === 'list' && (
        <>
          {sortedActive.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">
                  Active — {sortedActive.length}
                </h3>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <div className="space-y-3">
                {sortedActive.map(loan => (
                  <LoanCard
                    key={loan.id}
                    loan={loan}
                    outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                    lastUpdated={lastUpdatedMap[loan.id]}
                    linkPrefix={linkPrefix}
                  />
                ))}
              </div>
            </section>
          )}

          {sortedClosed.length > 0 && stageFilter === 'all' && (
            <section>
              <button
                type="button"
                onClick={() => setClosedExpanded(o => !o)}
                aria-expanded={closedExpanded}
                className="w-full flex items-center gap-3 mb-4 group"
              >
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap group-hover:text-gray-600 transition-colors flex items-center gap-1.5">
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${closedExpanded ? '' : '-rotate-90'}`}
                  />
                  Closed — {sortedClosed.length}
                </h3>
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 group-hover:text-gray-600 transition-colors whitespace-nowrap">
                  {closedExpanded ? 'Hide' : 'Show'}
                </span>
              </button>
              {closedExpanded && (
                <div className="space-y-3">
                  {sortedClosed.map(loan => (
                    <LoanCard
                      key={loan.id}
                      loan={loan}
                      outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                      lastUpdated={lastUpdatedMap[loan.id]}
                      linkPrefix={linkPrefix}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
