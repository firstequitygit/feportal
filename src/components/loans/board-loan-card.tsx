'use client'

import Link from 'next/link'
import { type Loan, type OutstandingCounts } from '@/lib/types'
import { formatCompactCurrency } from '@/lib/format'

type BoardLoanCardLoan = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
}

interface Props {
  loan: BoardLoanCardLoan
  outstanding: OutstandingCounts
  linkPrefix: string
}

const ZERO: OutstandingCounts = { you: 0, borrower: 0, team: 0, total: 0 }

function accentClass(loan: BoardLoanCardLoan, outstanding: OutstandingCounts): string {
  if (loan.loan_status === 'cancelled') return 'border-l-red-300'
  if (loan.loan_status === 'on_hold') return 'border-l-amber-400'
  if (loan.pipeline_stage === 'Closed') return 'border-l-gray-300'
  if (outstanding.you > 0) return 'border-l-red-400'
  if (outstanding.total > 0) return 'border-l-amber-300'
  return 'border-l-green-400'
}

interface ChipDescriptor {
  text: string
  className: string
}

function statusChip(loan: BoardLoanCardLoan, outstanding: OutstandingCounts): ChipDescriptor | null {
  if (loan.loan_status === 'cancelled') {
    return { text: 'Cancelled', className: 'bg-red-100 text-red-700' }
  }
  if (loan.loan_status === 'on_hold') {
    return { text: 'On Hold', className: 'bg-amber-100 text-amber-800' }
  }
  if (outstanding.you > 0) {
    return { text: `You ${outstanding.you}`, className: 'bg-red-100 text-red-700' }
  }
  if (outstanding.borrower > 0) {
    return { text: `Borrower ${outstanding.borrower}`, className: 'bg-amber-100 text-amber-700' }
  }
  if (outstanding.team > 0) {
    return { text: `Team ${outstanding.team}`, className: 'bg-gray-100 text-gray-600' }
  }
  return null
}

export function BoardLoanCard({ loan, outstanding = ZERO, linkPrefix }: Props) {
  const accent = accentClass(loan, outstanding)
  const chip = statusChip(loan, outstanding)
  const isDimmed = loan.loan_status === 'cancelled' || loan.pipeline_stage === 'Closed'

  return (
    <Link
      href={`${linkPrefix}/loans/${loan.id}`}
      className={`block group rounded-md border border-gray-200 border-l-4 ${accent} bg-white p-2 transition-all duration-150 hover:shadow-sm hover:border-gray-300 ${
        isDimmed ? 'opacity-70' : ''
      } ${loan.loan_status === 'on_hold' ? 'bg-amber-50/40' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-1.5">
        <p className="text-xs font-semibold text-gray-900 leading-tight truncate min-w-0 flex-1">
          {loan.property_address ?? 'Address not set'}
        </p>
        <p className="text-xs font-semibold text-gray-900 whitespace-nowrap">
          {formatCompactCurrency(loan.loan_amount)}
        </p>
      </div>
      <div className="flex items-center justify-between gap-1.5 mt-0.5">
        <p className="text-[11px] text-gray-500 truncate min-w-0 flex-1">
          {loan.borrowers?.full_name ?? <span className="italic">Unassigned</span>}
          {loan.loan_type ? <span className="text-gray-300"> · </span> : null}
          {loan.loan_type}
        </p>
        {chip && (
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${chip.className}`}
          >
            {chip.text}
          </span>
        )}
      </div>
    </Link>
  )
}
