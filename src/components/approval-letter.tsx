'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { type Condition, CONDITION_CATEGORIES } from '@/lib/types'
import { formatDate } from '@/lib/format-date'

const COMPANY_ADDRESS = '1330 Laurel Ave., Suite 101, Sea Girt, NJ 08750'
const COMPANY_WEBSITE = 'https://www.fefunding.com/'
const COMPANY_EMAIL = 'ascovill@fefunding.com'
const COMPANY_PHONE = '732-820-9886'

const DEFAULT_INTRO =
  'We are pleased to inform you that your loan application has been conditionally approved. ' +
  'Final approval and funding are subject to the satisfactory completion of the conditions listed below. ' +
  'Please submit the required items at your earliest convenience to keep your closing on schedule.'

const DEFAULT_CLOSING =
  'If you have any questions or need assistance providing any of the items above, please contact your loan officer directly. ' +
  'We appreciate the opportunity to work with you and look forward to a smooth closing.'

interface LoanFields {
  property_address: string | null
  loan_amount: number | null
  interest_rate: number | null
  ltv: number | null
  arv: number | null
  rehab_budget: number | null
  term_months: number | null
  loan_type: string | null
  entity_name: string | null
  loan_number: string | null
  estimated_closing_date: string | null
}

interface Props {
  loan: LoanFields
  borrower: { full_name: string | null; email: string; entity_name: string | null } | null
  loanOfficer: { full_name: string; email: string | null; phone: string | null; title: string | null } | null
  conditions: Condition[]
  backHref: string
}

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function todayDateString(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function groupByCategory(conditions: Condition[]) {
  const groups: { label: string; items: Condition[] }[] = []
  for (const cat of CONDITION_CATEGORIES) {
    const items = conditions.filter(c => c.category === cat.value)
    if (items.length > 0) groups.push({ label: cat.label, items })
  }
  const uncategorized = conditions.filter(c => !c.category)
  if (uncategorized.length > 0) groups.push({ label: 'Other Conditions', items: uncategorized })
  return groups
}

export function ApprovalLetter({ loan, borrower, loanOfficer, conditions, backHref }: Props) {
  const [letterDate, setLetterDate] = useState<string>(todayDateString())
  const [intro, setIntro] = useState<string>(DEFAULT_INTRO)
  const [closing, setClosing] = useState<string>(DEFAULT_CLOSING)

  const grouped = groupByCategory(conditions)
  const borrowerName = borrower?.full_name ?? '[Borrower Name]'
  const subjectAddress = loan.property_address ?? '[Property Address]'

  const termsRows: { label: string; value: string }[] = [
    { label: 'Property', value: loan.property_address ?? '—' },
    { label: 'Loan Type', value: loan.loan_type ?? '—' },
    { label: 'Loan Amount', value: formatCurrency(loan.loan_amount) },
    { label: 'Interest Rate', value: loan.interest_rate !== null ? `${loan.interest_rate}%` : '—' },
    { label: 'Term', value: loan.term_months ? `${loan.term_months} months` : '—' },
    { label: 'LTV', value: loan.ltv !== null ? `${loan.ltv}%` : '—' },
  ]
  if (loan.arv !== null) termsRows.push({ label: 'ARV', value: formatCurrency(loan.arv) })
  if (loan.rehab_budget !== null) termsRows.push({ label: 'Construction Budget', value: formatCurrency(loan.rehab_budget) })
  if (loan.entity_name) termsRows.push({ label: 'Borrowing Entity', value: loan.entity_name })
  if (loan.loan_number) termsRows.push({ label: 'Loan Number', value: loan.loan_number })
  if (loan.estimated_closing_date) termsRows.push({ label: 'Est. Closing Date', value: formatDate(loan.estimated_closing_date) })

  return (
    <>
      {/* Print-only styles */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          .letter-page { padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
          body { background: white !important; }
          @page { margin: 0.5in; size: letter; }
        }
        .editable-text {
          width: 100%;
          background: transparent;
          border: 1px dashed transparent;
          padding: 6px 8px;
          border-radius: 4px;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          color: inherit;
          resize: vertical;
          outline: none;
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
        <div className="letter-page max-w-4xl mx-auto bg-white shadow-md print:shadow-none px-12 py-10 text-gray-900" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>

          {/* Letterhead */}
          <div className="flex items-end justify-between gap-6 pb-6 border-b-2 border-gray-800">
            <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="h-16 w-auto" priority />
            <div className="text-right text-xs text-gray-700 leading-relaxed">
              <p>{COMPANY_ADDRESS}</p>
              <p>{COMPANY_WEBSITE}</p>
              <p>{COMPANY_EMAIL}</p>
              <p>{COMPANY_PHONE}</p>
            </div>
          </div>

          {/* Date */}
          <div className="mt-8">
            <input
              type="text"
              value={letterDate}
              onChange={e => setLetterDate(e.target.value)}
              className="editable-text text-sm"
              aria-label="Letter date"
            />
          </div>

          {/* Recipient */}
          <div className="mt-6 text-sm leading-relaxed">
            <p className="font-semibold">{borrowerName}</p>
            {borrower?.entity_name && <p>{borrower.entity_name}</p>}
            <p className="mt-2 text-gray-700">Re: Conditional Loan Approval — {subjectAddress}</p>
          </div>

          {/* Greeting */}
          <p className="mt-6 text-sm">Dear {borrowerName},</p>

          {/* Intro paragraph — editable */}
          <div className="mt-4 text-sm leading-relaxed">
            <textarea
              value={intro}
              onChange={e => setIntro(e.target.value)}
              rows={4}
              className="editable-text"
              aria-label="Introductory paragraph"
            />
          </div>

          {/* Loan terms summary */}
          <div className="mt-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-800 mb-2">Loan Terms</h3>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {termsRows.map(row => (
                  <tr key={row.label} className="border-b border-gray-200 last:border-b-0">
                    <td className="py-1.5 pr-4 text-gray-600 w-1/3 align-top">{row.label}</td>
                    <td className="py-1.5 font-medium">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Conditions */}
          <div className="mt-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-800 mb-2">
              Outstanding Conditions
            </h3>
            {grouped.length === 0 ? (
              <p className="text-sm italic text-gray-600">No outstanding conditions at this time.</p>
            ) : (
              <div className="space-y-4">
                {grouped.map(group => (
                  <div key={group.label}>
                    <h4 className="text-sm font-semibold text-gray-800 mb-1.5">{group.label}</h4>
                    <ol className="list-decimal list-outside pl-6 space-y-1.5 text-sm">
                      {group.items.map(c => (
                        <li key={c.id}>
                          <span className="font-medium">{c.title}</span>
                          {c.description && (
                            <span className="text-gray-700"> — {c.description}</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Closing paragraph — editable */}
          <div className="mt-6 text-sm leading-relaxed">
            <textarea
              value={closing}
              onChange={e => setClosing(e.target.value)}
              rows={3}
              className="editable-text"
              aria-label="Closing paragraph"
            />
          </div>

          {/* Signature */}
          <div className="mt-8 text-sm">
            <p>Sincerely,</p>
            <div className="mt-4">
              <p className="font-semibold">{loanOfficer?.full_name ?? '—'}</p>
              {loanOfficer?.title && <p className="text-gray-700">{loanOfficer.title}</p>}
              <p className="text-gray-700">First Equity Funding</p>
              {loanOfficer?.phone && <p className="text-gray-700 mt-1">{loanOfficer.phone}</p>}
              {loanOfficer?.email && <p className="text-gray-700">{loanOfficer.email}</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
