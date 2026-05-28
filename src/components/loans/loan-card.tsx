// src/components/loans/loan-card.tsx
'use client'

import Link from 'next/link'
import { ChevronRight, MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { type Loan, type PipelineStage, type OutstandingCounts } from '@/lib/types'

type LoanCardLoan = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
}

interface Props {
  loan: LoanCardLoan
  outstanding: OutstandingCounts
  linkPrefix: string
}

const ZERO: OutstandingCounts = { you: 0, borrower: 0, team: 0, total: 0 }

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val)
}

function stageBadgeColor(stage: PipelineStage | null): string {
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

function formatStage(stage: PipelineStage | string | null): string {
  if (!stage) return 'Unknown'
  return stage.split(' /')[0].trim()
}

function accentClass(loan: LoanCardLoan, outstanding: OutstandingCounts): string {
  const isClosed = loan.pipeline_stage === 'Closed'
  const isOnHold = loan.loan_status === 'on_hold'
  const isCancelled = loan.loan_status === 'cancelled'
  if (isCancelled) return 'border-l-red-300'
  if (isOnHold) return 'border-l-amber-400'
  if (isClosed) return 'border-l-gray-300'
  if (outstanding.you > 0) return 'border-l-red-400'
  if (outstanding.total > 0) return 'border-l-amber-300'
  return 'border-l-green-400'
}

export function LoanCard({ loan, outstanding = ZERO, linkPrefix }: Props) {
  const isClosed = loan.pipeline_stage === 'Closed'
  const isOnHold = loan.loan_status === 'on_hold'
  const isCancelled = loan.loan_status === 'cancelled'
  const accent = accentClass(loan, outstanding)

  return (
    <Link href={`${linkPrefix}/loans/${loan.id}`} className="block group">
      <Card
        className={`border border-gray-200 border-l-4 ${accent} transition-all duration-150 group-hover:shadow-sm group-hover:border-gray-300 ${
          isClosed || isCancelled ? 'opacity-70' : ''
        } ${isOnHold ? 'bg-amber-50/40' : ''}`}
      >
        <CardContent className="px-4 py-2.5">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <p className="font-semibold text-gray-900 truncate text-[15px] leading-tight">
                  {loan.property_address ?? 'Address not set'}
                </p>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 ml-5 truncate">
                {loan.borrowers?.full_name ?? 'No borrower assigned'}
                {loan.loan_type ? <span className="text-gray-300"> · </span> : null}
                {loan.loan_type}
                <span className="text-gray-300"> · </span>
                {formatCurrency(loan.loan_amount)}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {outstanding.you > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                  You {outstanding.you}
                </span>
              )}
              {outstanding.borrower > 0 && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
                  Borrower {outstanding.borrower}
                </span>
              )}
              {outstanding.team > 0 && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                  Team {outstanding.team}
                </span>
              )}
              {isOnHold && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap">
                  On Hold
                </span>
              )}
              {isCancelled && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                  Cancelled
                </span>
              )}
              <span
                className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap ${stageBadgeColor(
                  loan.pipeline_stage,
                )}`}
              >
                {isClosed ? 'Closed' : formatStage(loan.pipeline_stage)}
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
