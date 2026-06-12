'use client'

// Committee Review Sheet — auto-selects DSCR vs Fix&Flip layout
// based on the loan_type. Mirrors the field set from the Airtable
// versions Alicyn is moving off of. UW prints to PDF; the printable
// view is plain HTML/CSS so it'll save to PDF via the browser's
// built-in dialog (same flow as the Conditional Approval Letter).
//
// Fields with no portal source today are rendered as blank lines so
// the UW can fill them in by hand on the saved PDF — currently:
//
//   - Wholesaler Profits
//   - Sizer Date (DSCR only)
//   - Money Multiple (Fix&Flip only)
//   - Properties Verified? (Fix&Flip only)

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Download } from 'lucide-react'
import {
  fmtCurrency,
  fmtLetterDate,
  fmtRatePct,
  fmtRatio,
  calcOriginationFee,
  calcBrokerFee,
  calcMonthlyPayment,
  calcDSCR,
} from '@/lib/loan-doc-format'

const COMPANY_ADDRESS_LINE = '1330 Laurel Avenue, Suite 101 Sea Girt | New Jersey | 08750'
const COMPANY_PHONE_LINE = 'P: 732-359-7800 | F: 732-907-1913'

interface CommitteeReviewLoan {
  loan_type: string | null
  loan_number: string | null
  loan_amount: number | null
  interest_rate: number | null
  arv: number | null
  rehab_budget: number | null
  term_months: number | null
  interest_only: string | null
  entity_name: string | null
  property_address: string | null
}

interface CommitteeReviewDetails {
  loan_type_one: string | null
  credit_score: number | null
  points: number | null
  broker_points: number | null
  purchase_price: number | null
  value_as_is: number | null
  initial_loan_amount: number | null
  underwriting_fee: number | null
  prepayment_penalty: string | null
  exceptions: string | null
  qualifying_rent: number | null
  annual_property_tax: number | null
  annual_insurance_premium: number | null
  annual_flood_insurance: number | null
  annual_hoa_dues: number | null
  amortization_schedule: string | null
}

interface Props {
  loanId: string
  loan: CommitteeReviewLoan
  details: CommitteeReviewDetails
  borrowerName: string | null
  coBorrowerNames: string[]
  loanOfficerName: string | null
  brokerName: string | null
  backHref: string
}

export function CommitteeReviewSheet({
  loanId,
  loan,
  details,
  borrowerName,
  coBorrowerNames,
  loanOfficerName,
  brokerName,
  backHref,
}: Props) {
  const [letterDate, setLetterDate] = useState<string>(fmtLetterDate())

  const isDscr = loan.loan_type === 'Rental (DSCR)'

  // Derived calculations
  const originationFee = calcOriginationFee(loan.loan_amount, details.points)
  const brokerFee = calcBrokerFee(loan.loan_amount, details.broker_points)
  const commitmentFee = details.underwriting_fee // per spec — Commitment Fee maps to Underwriting Fee

  // DSCR ratios
  const loanOverPurchase =
    loan.loan_amount && details.purchase_price
      ? loan.loan_amount / details.purchase_price
      : null
  const loanOverAsIs =
    loan.loan_amount && details.value_as_is
      ? loan.loan_amount / details.value_as_is
      : null

  // Fix&Flip ratios
  const initialOverTotalCost =
    details.initial_loan_amount && details.purchase_price !== null && details.purchase_price !== undefined && details.value_as_is !== null
      ? details.initial_loan_amount /
        ((details.purchase_price ?? 0) + (loan.rehab_budget ?? 0))
      : null
  const initialOverAsIs =
    details.initial_loan_amount && details.value_as_is
      ? details.initial_loan_amount / details.value_as_is
      : null
  const loanToArv =
    loan.loan_amount && loan.arv ? loan.loan_amount / loan.arv : null

  // DSCR calc (Rental only)
  const monthly = calcMonthlyPayment(
    loan.loan_amount,
    loan.interest_rate,
    loan.term_months,
    loan.interest_only,
    details.amortization_schedule,
  )
  const dscr = isDscr
    ? calcDSCR(
        details.qualifying_rent,
        monthly,
        details.annual_property_tax,
        details.annual_insurance_premium,
        details.annual_flood_insurance,
        details.annual_hoa_dues,
      )
    : null

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
          {/* Server-rendered PDF download. The current letter-date
              edit in the preview is passed through as ?date= so the
              printed file matches what the UW saw on screen. */}
          <a
            href={`/api/committee-review/${loanId}/pdf?date=${encodeURIComponent(letterDate)}`}
            className="flex items-center gap-2 bg-primary text-white text-sm font-medium px-4 py-2 rounded-md hover:opacity-90"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </a>
        </div>
      </div>

      <div className="bg-gray-100 min-h-screen py-8 print:py-0 print:bg-white">
        <div
          className="letter-page max-w-4xl mx-auto bg-white shadow-md print:shadow-none px-12 py-10 text-gray-900"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {/* Letterhead */}
          <div className="flex items-start justify-between gap-6">
            <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="h-14 w-auto" priority />
            <div className="text-right text-[11px] text-gray-700 leading-tight">
              <p>{COMPANY_ADDRESS_LINE}</p>
              <p>{COMPANY_PHONE_LINE}</p>
            </div>
          </div>

          {/* Title row */}
          <div className="mt-6 flex items-center justify-between">
            <h1 className="text-lg font-bold tracking-wide">UNDERWRITING OVERVIEW</h1>
            <input
              type="text"
              value={letterDate}
              onChange={e => setLetterDate(e.target.value)}
              className="editable-text text-sm w-24 text-right"
              aria-label="Date"
            />
          </div>

          {/* Identity row */}
          <Table4Col className="mt-3"
            headers={['Borrower', 'Co-Borrower(s)', 'LLC/Entity Name', 'Property Address']}
            values={[
              borrowerName ?? '',
              coBorrowerNames.join(', '),
              loan.entity_name ?? '',
              loan.property_address ?? '',
            ]}
          />

          <Table3Col className="mt-2"
            headers={['Loan Number', 'Loan Type', 'Loan Purpose']}
            values={[loan.loan_number ?? '', loan.loan_type ?? '', details.loan_type_one ?? '']}
          />

          <Table3Col className="mt-2"
            headers={['Credit Score', 'Interest Rate', 'Points']}
            values={[
              details.credit_score !== null && details.credit_score !== undefined ? String(details.credit_score) : '',
              fmtRatePct(loan.interest_rate),
              details.points !== null && details.points !== undefined ? String(details.points) : '0',
            ]}
          />

          {/* Money row — variant-dependent */}
          {isDscr ? (
            <>
              <Table3Col className="mt-2"
                headers={['Contract Sales Price', '"As-is" Value', 'Loan Amount']}
                values={[
                  fmtCurrency(details.purchase_price),
                  fmtCurrency(details.value_as_is),
                  fmtCurrency(loan.loan_amount),
                ]}
              />
              <Table2Col className="mt-2"
                headers={['Loan/Total Cost', 'Loan/As-Is']}
                values={[fmtRatio(loanOverPurchase), fmtRatio(loanOverAsIs)]}
              />
            </>
          ) : (
            <>
              {/* Fix&Flip / New Construction has the wider money row */}
              <Table6Col className="mt-2"
                headers={[
                  'Contract Sales Price',
                  '"As-is" Value',
                  'Construction Cost',
                  'After Repaired Value',
                  'Initial Loan Amount',
                  'Loan Amount',
                ]}
                values={[
                  fmtCurrency(details.purchase_price),
                  fmtCurrency(details.value_as_is),
                  fmtCurrency(loan.rehab_budget),
                  fmtCurrency(loan.arv),
                  fmtCurrency(details.initial_loan_amount),
                  fmtCurrency(loan.loan_amount),
                ]}
              />
              <Table4Col className="mt-2"
                headers={['Money Multiple', 'Initial Loan/Total Cost', 'Initial Loan/As-Is', 'Loan to ARV']}
                values={[
                  '', // blank placeholder — UW fills by hand
                  fmtRatio(initialOverTotalCost),
                  fmtRatio(initialOverAsIs),
                  fmtRatio(loanToArv),
                ]}
              />
            </>
          )}

          {/* People + fees + exceptions table */}
          <div className="mt-4 border border-gray-300">
            <KeyValueRow label="Loan Originator" value={loanOfficerName ?? ''} />
            <KeyValueRow label="Broker" value={brokerName ?? ''} />
            <KeyValueRow label="Broker Fee" value={fmtCurrency(brokerFee)} />
            <KeyValueRow label="Wholesaler Profits" value="" />
            <KeyValueRow label="Origination Fee" value={fmtCurrency(originationFee)} />
            <KeyValueRow label="Commitment Fee" value={fmtCurrency(commitmentFee)} />
            <KeyValueRow label="Prepayment Penalty" value={details.prepayment_penalty ?? ''} />
            {!isDscr && <KeyValueRow label="Properties Verified?" value="" />}
            <KeyValueRow label="Exceptions Note(s)" value={details.exceptions ?? ''} />
            {isDscr && (
              <>
                <KeyValueRow label="DSCR" value={dscr !== null ? dscr.toFixed(2) : '0'} />
                <KeyValueRow label="Sizer Date" value="" />
              </>
            )}
          </div>

          {/* DSCR-only: 30 Year Loans tax/HOI/flood block */}
          {isDscr && (
            <div className="mt-6">
              <h3 className="text-sm font-bold">30 Year Loans</h3>
              <div className="mt-1 border border-gray-300">
                <KeyValueRow label="Tax" value={fmtCurrency(details.annual_property_tax)} />
                <KeyValueRow label="HOI Premium" value={fmtCurrency(details.annual_insurance_premium)} />
                <KeyValueRow label="Flood" value={fmtCurrency(details.annual_flood_insurance)} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ---- Print styles + small layout helpers ----

function PrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        .no-print { display: none !important; }
        .letter-page { padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
        body { background: white !important; }
        @page { margin: 0.5in; size: letter; }
      }
      .editable-text {
        background: transparent;
        border: 1px dashed transparent;
        padding: 2px 4px;
        border-radius: 4px;
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        color: inherit;
        outline: none;
      }
      .editable-text:hover { border-color: #d1d5db; }
      .editable-text:focus { border-color: #9ca3af; background: #fafafa; }
      @media print {
        .editable-text { border: none !important; padding: 0 !important; background: transparent !important; }
      }
    `}</style>
  )
}

function Table4Col({ headers, values, className = '' }: { headers: string[]; values: string[]; className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-4 border border-gray-300 text-sm">
        {headers.map(h => (
          <div key={h} className="bg-gray-100 px-3 py-2 text-center font-semibold border-r last:border-r-0 border-gray-300">
            {h}
          </div>
        ))}
        {values.map((v, i) => (
          <div key={i} className="px-3 py-2 border-r last:border-r-0 border-t border-gray-300 min-h-[28px]">
            {v}
          </div>
        ))}
      </div>
    </div>
  )
}

function Table3Col({ headers, values, className = '' }: { headers: string[]; values: string[]; className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-3 border border-gray-300 text-sm">
        {headers.map(h => (
          <div key={h} className="bg-gray-100 px-3 py-2 text-center font-semibold border-r last:border-r-0 border-gray-300">
            {h}
          </div>
        ))}
        {values.map((v, i) => (
          <div key={i} className="px-3 py-2 border-r last:border-r-0 border-t border-gray-300 min-h-[28px]">
            {v}
          </div>
        ))}
      </div>
    </div>
  )
}

function Table2Col({ headers, values, className = '' }: { headers: string[]; values: string[]; className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-2 border border-gray-300 text-sm">
        {headers.map(h => (
          <div key={h} className="bg-gray-100 px-3 py-2 font-semibold border-r last:border-r-0 border-gray-300">
            {h}
          </div>
        ))}
        {values.map((v, i) => (
          <div key={i} className="px-3 py-2 border-r last:border-r-0 border-t border-gray-300 min-h-[28px]">
            {v}
          </div>
        ))}
      </div>
    </div>
  )
}

function Table6Col({ headers, values, className = '' }: { headers: string[]; values: string[]; className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-6 border border-gray-300 text-xs">
        {headers.map(h => (
          <div key={h} className="bg-gray-100 px-2 py-2 text-center font-semibold border-r last:border-r-0 border-gray-300">
            {h}
          </div>
        ))}
        {values.map((v, i) => (
          <div key={i} className="px-2 py-2 border-r last:border-r-0 border-t border-gray-300 min-h-[28px]">
            {v}
          </div>
        ))}
      </div>
    </div>
  )
}

function KeyValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_2fr] text-sm border-b last:border-b-0 border-gray-300">
      <div className="px-3 py-2 bg-gray-50 border-r border-gray-300">{label}</div>
      <div className="px-3 py-2 min-h-[36px]">{value}</div>
    </div>
  )
}
