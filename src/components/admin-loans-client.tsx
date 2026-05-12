'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ChevronUp, ChevronDown, ChevronsUpDown, Archive } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { type Loan, PIPELINE_STAGES, type PipelineStage, type LoanType } from '@/lib/types'

type SortKey = 'property' | 'borrower' | 'loan_type' | 'loan_amount' | 'pipeline_stage'
type SortDir = 'asc' | 'desc'

export type LoanWithMeta = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
  outstandingCount: number
  pendingReviewCount: number
  totalConditionsCount: number
}

const LOAN_TYPES: LoanType[] = ['Bridge', 'Fix & Flip', 'New Construction', 'DSCR']

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function formatStage(stage: string | null): string {
  if (!stage) return '—'
  return stage.split(' /')[0].trim()
}

function stageColor(stage: PipelineStage | string | null): string {
  switch (stage) {
    case 'New Loan / Listing':      return 'bg-gray-100 text-gray-700'
    case 'Appraisal Paid':          return 'bg-blue-100 text-blue-700'
    case 'Processing / Listed':     return 'bg-yellow-100 text-yellow-700'
    case 'Underwriting / Contract': return 'bg-orange-100 text-orange-700'
    case 'Cleared to Close':        return 'bg-green-100 text-green-700'
    case 'Closed':                  return 'bg-purple-100 text-purple-700'
    default:                        return 'bg-gray-100 text-gray-600'
  }
}

export function AdminLoansClient({ loans }: { loans: LoanWithMeta[] }) {
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [view, setView] = useState<'list' | 'kanban'>('list')
  const [sortKey, setSortKey] = useState<SortKey>('pipeline_stage')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const archivedCount = loans.filter(l => l.archived).length

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const results = loans.filter(loan => {
      if (loan.archived) return false
      const matchesSearch =
        !q ||
        (loan.property_address?.toLowerCase().includes(q) ?? false) ||
        (loan.borrowers?.full_name?.toLowerCase().includes(q) ?? false)
      const matchesStage = stageFilter === 'all' || loan.pipeline_stage === stageFilter
      const matchesType  = typeFilter  === 'all' || loan.loan_type      === typeFilter
      return matchesSearch && matchesStage && matchesType
    })

    results.sort((a, b) => {
      let aVal: string | number | null = null
      let bVal: string | number | null = null

      switch (sortKey) {
        case 'property':
          aVal = a.property_address?.toLowerCase() ?? ''
          bVal = b.property_address?.toLowerCase() ?? ''
          break
        case 'borrower':
          aVal = a.borrowers?.full_name?.toLowerCase() ?? ''
          bVal = b.borrowers?.full_name?.toLowerCase() ?? ''
          break
        case 'loan_type':
          aVal = a.loan_type?.toLowerCase() ?? ''
          bVal = b.loan_type?.toLowerCase() ?? ''
          break
        case 'loan_amount':
          aVal = a.loan_amount ?? -1
          bVal = b.loan_amount ?? -1
          break
        case 'pipeline_stage':
          aVal = PIPELINE_STAGES.indexOf(a.pipeline_stage as PipelineStage)
          bVal = PIPELINE_STAGES.indexOf(b.pipeline_stage as PipelineStage)
          break
      }

      if (aVal === bVal) return 0
      const cmp = aVal! < bVal! ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })

    return results
  }, [loans, search, stageFilter, typeFilter, sortKey, sortDir])

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          placeholder="Search by property or borrower..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-2 bg-white text-gray-700"
        >
          <option value="all">All Stages</option>
          {PIPELINE_STAGES.map(s => (
            <option key={s} value={s}>{formatStage(s)}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-2 bg-white text-gray-700"
        >
          <option value="all">All Types</option>
          {LOAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {archivedCount > 0 && (
          <Link
            href="/admin/archived"
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-500 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors whitespace-nowrap"
          >
            <Archive className="w-3.5 h-3.5" />
            Archived ({archivedCount})
          </Link>
        )}

        <div className="ml-auto flex border border-gray-300 rounded-md overflow-hidden">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-2 text-sm transition-colors ${
              view === 'list' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            ☰ List
          </button>
          <button
            onClick={() => setView('kanban')}
            className={`px-3 py-2 text-sm border-l border-gray-300 transition-colors ${
              view === 'kanban' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            ⊞ Board
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <ListView loans={filtered} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
      ) : (
        <KanbanView loans={filtered} />
      )}
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="inline w-3.5 h-3.5 ml-1 text-gray-300" />
  return dir === 'asc'
    ? <ChevronUp className="inline w-3.5 h-3.5 ml-1 text-primary" />
    : <ChevronDown className="inline w-3.5 h-3.5 ml-1 text-primary" />
}

function ListView({
  loans,
  sortKey,
  sortDir,
  onSort,
}: {
  loans: LoanWithMeta[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}) {
  if (loans.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          No loans match your search.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-3 pr-4 font-medium">
                  <button type="button" onClick={() => onSort('property')} className="flex items-center gap-1 hover:text-gray-900 cursor-pointer select-none whitespace-nowrap">
                    Property <SortIcon active={sortKey === 'property'} dir={sortDir} />
                  </button>
                </th>
                <th className="pb-3 pr-4 font-medium">
                  <button type="button" onClick={() => onSort('borrower')} className="flex items-center gap-1 hover:text-gray-900 cursor-pointer select-none whitespace-nowrap">
                    Borrower <SortIcon active={sortKey === 'borrower'} dir={sortDir} />
                  </button>
                </th>
                <th className="pb-3 pr-4 font-medium">
                  <button type="button" onClick={() => onSort('loan_type')} className="flex items-center gap-1 hover:text-gray-900 cursor-pointer select-none whitespace-nowrap">
                    Type <SortIcon active={sortKey === 'loan_type'} dir={sortDir} />
                  </button>
                </th>
                <th className="pb-3 pr-4 font-medium">
                  <button type="button" onClick={() => onSort('loan_amount')} className="flex items-center gap-1 hover:text-gray-900 cursor-pointer select-none whitespace-nowrap">
                    Amount <SortIcon active={sortKey === 'loan_amount'} dir={sortDir} />
                  </button>
                </th>
                <th className="pb-3 pr-4 font-medium">
                  <button type="button" onClick={() => onSort('pipeline_stage')} className="flex items-center gap-1 hover:text-gray-900 cursor-pointer select-none whitespace-nowrap">
                    Stage <SortIcon active={sortKey === 'pipeline_stage'} dir={sortDir} />
                  </button>
                </th>
                <th className="pb-3 font-medium pr-4">Conditions</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loans.map(loan => (
                <tr key={loan.id} className="hover:bg-gray-50">
                  <td className="py-3 font-medium text-gray-900 max-w-[200px] truncate pr-4">
                    {loan.property_address ?? '—'}
                  </td>
                  <td className="py-3 text-gray-600 pr-4">
                    {loan.borrowers?.full_name ?? (
                      <span className="text-gray-400 italic">Unassigned</span>
                    )}
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
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function KanbanView({ loans }: { loans: LoanWithMeta[] }) {
  // Board view shows New Loan → Cleared to Close only (excludes Closed)
  const BOARD_STAGES = PIPELINE_STAGES.slice(0, 5)
  const columns = BOARD_STAGES.map(stage => ({
    stage,
    loans: loans.filter(l => l.pipeline_stage === stage),
  }))

  return (
    <div className="pb-4">
      <div className="grid grid-cols-5 gap-3">
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
              {stageLoans.map(loan => (
                <Link key={loan.id} href={`/admin/loans/${loan.id}`}>
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
                      {loan.outstandingCount > 0 ? (
                        <div className="mt-2">
                          <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                            {loan.outstandingCount} outstanding
                          </span>
                        </div>
                      ) : loan.pendingReviewCount > 0 ? (
                        <div className="mt-2">
                          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            {loan.pendingReviewCount} pending review
                          </span>
                        </div>
                      ) : loan.totalConditionsCount > 0 ? (
                        <div className="mt-2">
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                            All Satisfied
                          </span>
                        </div>
                      ) : null}
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
