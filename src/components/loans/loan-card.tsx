// src/components/loans/loan-card.tsx
'use client'

import Link from 'next/link'
import { ChevronRight, MapPin, MessageSquareText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { type Loan, type PipelineStage, type OutstandingCounts } from '@/lib/types'
import { formatLoanName } from '@/lib/format-loan-name'

type LoanCardLoan = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
}

interface Props {
  loan: LoanCardLoan
  outstanding: OutstandingCounts
  linkPrefix: string
  /** Most recent Closer Notes entry on this loan, when one exists. */
  latestCloserNote?: string | null
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

/**
 * Short "MM/DD/YY" date for the loan-card subtitle. Parses as a local
 * date by splitting the ISO components — keeps a "2026-06-12" string
 * from rendering as Jun 11 in negative-offset timezones.
 */
function formatShortDate(val: string | null | undefined): string | null {
  if (!val) return null
  // Accept both "2026-06-12" and full ISO timestamps — only need the date part.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(val)
  if (!m) return null
  const [, , mm, dd] = m
  const yy = m[1].slice(2)
  return `${Number(mm)}/${Number(dd)}/${yy}`
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

export function LoanCard({ loan, outstanding = ZERO, linkPrefix, latestCloserNote }: Props) {
  const isClosed = loan.pipeline_stage === 'Closed'
  const isOnHold = loan.loan_status === 'on_hold'
  const isCancelled = loan.loan_status === 'cancelled'
  const accent = accentClass(loan, outstanding)

  return (
    <Link href={`${linkPrefix}/loans/${loan.id}`} className="block group">
      <Card
        className={`gap-0 py-0 border border-gray-200 border-l-4 ${accent} transition-all duration-150 group-hover:shadow-sm group-hover:border-gray-300 ${
          isClosed || isCancelled ? 'opacity-70' : ''
        } ${isOnHold ? 'bg-amber-50/40' : ''}`}
      >
        <CardContent className="px-3.5 py-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <p className="font-semibold text-gray-900 truncate text-sm leading-tight">
                  {formatLoanName({
                    borrowerName: loan.borrowers?.full_name,
                    propertyAddress: loan.property_address,
                    loanNumber: loan.loan_number,
                  })}
                </p>
              </div>
              {/* Subtitle: city/state/ZIP from the address (skip the
                  street since it's already in the title), then loan
                  type + amount + dates. Borrower name is intentionally
                  not repeated here — it's in the title above. */}
              <p className="text-xs text-gray-500 mt-px ml-5 truncate">
                {(() => {
                  // Everything after the first comma in property_address,
                  // trimmed. Falls back to '—' when only the street was
                  // entered (no city/state) so the row's height stays
                  // consistent.
                  const addr = loan.property_address?.trim() ?? ''
                  const i = addr.indexOf(',')
                  const rest = i >= 0 ? addr.slice(i + 1).trim() : ''
                  return rest ? rest : (loan.borrowers?.full_name ? 'No city set' : 'No borrower assigned')
                })()}
                {loan.loan_type ? <span className="text-gray-300"> · </span> : null}
                {loan.loan_type}
                <span className="text-gray-300"> · </span>
                {formatCurrency(loan.loan_amount)}
                {/* Estimated closing + rate lock expiration. Each only
                    renders when set — keeps cards without dates clean
                    instead of showing "Close —". */}
                {(() => {
                  const close = formatShortDate(loan.estimated_closing_date)
                  return close ? (
                    <>
                      <span className="text-gray-300"> · </span>
                      Close {close}
                    </>
                  ) : null
                })()}
                {(() => {
                  const rate = formatShortDate(loan.rate_lock_expiration_date)
                  return rate ? (
                    <>
                      <span className="text-gray-300"> · </span>
                      Rate exp {rate}
                    </>
                  ) : null
                })()}
              </p>
              {/* Latest Closer Notes entry on this loan, when one exists.
                  Rendered on its own line so the dates row stays clean.
                  Truncate covers anything longer than the card width. */}
              {latestCloserNote && (
                <p
                  className="text-xs text-gray-500 italic mt-0.5 ml-5 truncate flex items-center gap-1"
                  title={latestCloserNote}
                >
                  <MessageSquareText className="w-3 h-3 text-gray-400 shrink-0" aria-hidden />
                  <span className="font-medium text-gray-600 not-italic">Closer:</span>
                  <span className="truncate">{latestCloserNote}</span>
                </p>
              )}
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
