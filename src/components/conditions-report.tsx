'use client'

// Printable list of a loan's conditions — title, details, status, and
// the internal staff notes for each. Plain HTML/CSS so staff print to
// PDF via the browser dialog (same flow as the Committee Review Sheet).
// Conditions are grouped by category to match the on-screen lists.

import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Printer } from 'lucide-react'
import { type Condition, type ConditionStatus } from '@/lib/types'
import type { ConditionNote } from '@/components/condition-notes'

// Display order: complete items first, action-needed last.
const STATUS_RANK: Record<ConditionStatus, number> = {
  'Satisfied':    0,
  'Waived':       1,
  'Received':     2,
  'Under Review': 3,
  'Outstanding':  4,
  'Rejected':     5,
}

interface Props {
  loanName: string
  loanNumber: string | null
  propertyAddress: string | null
  conditions: Condition[]
  notesByCondition: Record<string, ConditionNote[]>
  backHref: string
}

function statusClass(status: ConditionStatus): string {
  switch (status) {
    case 'Satisfied':    return 'text-green-700'
    case 'Waived':       return 'text-gray-500'
    case 'Under Review': return 'text-blue-700'
    case 'Received':     return 'text-yellow-700'
    case 'Rejected':     return 'text-red-700'
    case 'Outstanding':  return 'text-red-600'
    default:             return 'text-gray-700'
  }
}

function formatDateTime(val: string): string {
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function ConditionsReport({
  loanName,
  loanNumber,
  propertyAddress,
  conditions,
  notesByCondition,
  backHref,
}: Props) {
  // Flat list ordered by status (complete → action-needed).
  const sorted = [...conditions].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
  )

  const outstanding = conditions.filter(
    c => c.status === 'Outstanding' || c.status === 'Rejected',
  ).length

  const printedOn = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <>
      <PrintStyles />

      {/* Toolbar — hidden on print */}
      <div className="no-print bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href={backHref} className="flex items-center gap-1.5 text-sm text-primary hover:opacity-80">
            <ArrowLeft className="w-4 h-4" />
            Back to Loan
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-primary text-white text-sm font-medium px-4 py-2 rounded-md hover:opacity-90"
          >
            <Printer className="w-4 h-4" />
            Print / Save PDF
          </button>
        </div>
      </div>

      <div className="bg-gray-100 min-h-screen py-8 print:py-0 print:bg-white">
        <div
          className="letter-page max-w-4xl mx-auto bg-white shadow-md print:shadow-none px-12 py-10 text-gray-900 text-sm"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {/* Letterhead */}
          <div className="flex items-start justify-between gap-6">
            <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="h-12 w-auto" priority />
            <p className="text-[11px] text-gray-500 whitespace-nowrap">Printed {printedOn}</p>
          </div>

          <h1 className="text-lg font-bold tracking-wide mt-6">LOAN CONDITIONS</h1>
          <div className="mt-1 text-sm text-gray-700">
            <p className="font-semibold">{loanName}</p>
            {propertyAddress && <p>{propertyAddress}</p>}
            <p className="text-gray-500">
              {loanNumber ? `Loan #${loanNumber}` : 'No loan number'}
              <span className="text-gray-300"> · </span>
              {conditions.length} condition{conditions.length !== 1 ? 's' : ''}
              <span className="text-gray-300"> · </span>
              {outstanding} outstanding
            </p>
          </div>

          {conditions.length === 0 ? (
            <p className="mt-8 text-gray-500">No conditions on this loan.</p>
          ) : (
            <div className="mt-6 space-y-4">
              {sorted.map(condition => {
                const notes = notesByCondition[condition.id] ?? []
                return (
                  <div key={condition.id} className="condition-row">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold text-gray-900">{condition.title}</p>
                      <span className={`text-xs font-semibold whitespace-nowrap ${statusClass(condition.status)}`}>
                        {condition.status}
                      </span>
                    </div>
                    {condition.description && (
                      <p className="text-xs text-gray-600 mt-0.5">{condition.description}</p>
                    )}
                    {condition.status === 'Rejected' && condition.rejection_reason && (
                      <p className="text-xs text-red-700 mt-0.5">Rejected: {condition.rejection_reason}</p>
                    )}
                    {/* Staff notes — only when present (blank otherwise). */}
                    {notes.length > 0 && (
                      <div className="mt-1 ml-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Staff Notes</p>
                        <ul className="mt-0.5 space-y-0.5 list-disc ml-3">
                          {notes.map(n => (
                            <li key={n.id} className="text-xs text-gray-700">
                              <span className="whitespace-pre-wrap">{n.content}</span>
                              <span className="text-gray-400"> — {n.created_by}{n.created_at ? `, ${formatDateTime(n.created_at)}` : ''}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function PrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        .no-print { display: none !important; }
        .letter-page { padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
        body { background: white !important; }
        @page { margin: 0.6in; size: letter; }
        /* Keep a condition (title + notes) from splitting across pages. */
        .condition-row { break-inside: avoid; }
      }
    `}</style>
  )
}
