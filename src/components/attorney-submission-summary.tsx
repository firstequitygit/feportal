'use client'

// Attorney Submission Summary — single page handed to the closing
// attorney. Fields come straight from Loan Details + Loan Summary.
// Miscellaneous Notes is editable inline so the UW can drop in
// loan-specific context before printing.

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { formatDate } from '@/lib/format-date'
import { lastNameOf, joinGuarantors, loanProgramLabel } from '@/lib/loan-doc-format'

interface Props {
  propertyAddress: string | null
  loanNumber: string | null
  loanType: string | null
  termMonths: number | null
  borrowerName: string | null
  coBorrowerNames: string[]
  entityName: string | null
  titleCompany: string | null
  titleContactName: string | null
  estimatedClosingDate: string | null
  initialNotes: string | null
  backHref: string
}

export function AttorneySubmissionSummary({
  propertyAddress,
  loanNumber,
  loanType,
  termMonths,
  borrowerName,
  coBorrowerNames,
  entityName,
  titleCompany,
  titleContactName,
  estimatedClosingDate,
  initialNotes,
  backHref,
}: Props) {
  const [notes, setNotes] = useState<string>(initialNotes ?? '')

  const guarantors = joinGuarantors(borrowerName, ...coBorrowerNames)
  const titleContactDisplay = [titleContactName, titleCompany]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(' / ')

  return (
    <>
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          .letter-page { padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
          body { background: white !important; }
          @page { margin: 0.75in; size: letter; }
        }
        .editable-text {
          background: transparent;
          border: 1px dashed transparent;
          padding: 4px 6px;
          border-radius: 4px;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          color: inherit;
          outline: none;
          resize: vertical;
          width: 100%;
        }
        .editable-text:hover { border-color: #d1d5db; }
        .editable-text:focus { border-color: #9ca3af; background: #fafafa; }
        @media print {
          .editable-text { border: none !important; padding: 0 !important; background: transparent !important; resize: none !important; }
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href={backHref} className="flex items-center gap-1.5 text-sm text-primary hover:opacity-80">
            <ArrowLeft className="w-4 h-4" />
            Back to Loan
          </Link>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-primary text-white text-sm font-medium px-4 py-2 rounded-md hover:opacity-90"
          >
            <Printer className="w-4 h-4" />
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="bg-gray-100 min-h-screen py-8 print:py-0 print:bg-white">
        <div
          className="letter-page max-w-4xl mx-auto bg-white shadow-md print:shadow-none px-12 py-10 text-gray-900 text-sm"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {/* Title + logo */}
          <div className="flex items-start justify-between">
            <h1 className="text-2xl font-bold">Attorney Submission Summary</h1>
            <Image
              src="/logo-main.png"
              alt="First Equity Funding"
              width={724}
              height={86}
              className="h-14 w-auto"
              priority
            />
          </div>

          <div className="mt-10 space-y-4 leading-relaxed">
            <Field label="Subject Property:" value={propertyAddress ?? ''} />
            <Field label="Borrower Last Name:" value={lastNameOf(borrowerName)} />
            <Field label="Loan Number:" value={loanNumber ?? ''} />
            <Field label="Loan Program:" value={loanProgramLabel(loanType, termMonths)} />
            <Field label="Borrower name:" value={borrowerName ?? ''} />
            <Field label="Guarantors on loan:" value={guarantors} />
            <Field label="Guarantor #1:" value={borrowerName ?? ''} />
            <Field label="Entity name:" value={entityName ?? ''} />
            <Field label="Title contact/s:" value={titleContactDisplay} />
            <Field
              label="Desired closing date:"
              value={estimatedClosingDate ? formatDate(estimatedClosingDate) : ''}
            />

            <div className="mt-8">
              <p className="font-semibold">Miscellaneous Notes:</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={8}
                className="editable-text mt-1"
                placeholder="Add any deal-specific context for the closing attorney…"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="font-semibold">{label}</span>
      <span>{value}</span>
    </div>
  )
}
