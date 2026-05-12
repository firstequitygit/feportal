'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EditableLoanField } from '@/components/editable-loan-field'
import { formatDate } from '@/lib/format-date'

/** Shape of the loan_details row. All fields nullable / optional. */
export interface LoanDetails {
  // Loan / Deal Overview
  investor_loan_number?: string | null
  loan_application?: string | null
  submitted_at?: string | null
  urgency?: string | null
  reason_canceled?: string | null
  underwriter_notes?: string | null
  exceptions?: string | null
  cross_collateralization?: boolean | null
  foreign_national?: boolean | null

  // Property Information
  property_street?: string | null
  property_city?: string | null
  property_state?: string | null
  property_zip?: string | null
  property_type?: string | null
  number_of_units?: number | null
  flood_zone?: string | null

  // Loan Terms
  initial_loan_amount?: number | null
  cash_out_amount?: number | null
  rate_type?: string | null
  points?: number | null
  broker_points?: number | null
  underwriting_fee?: number | null
  legal_doc_prep_fee?: number | null
  prepayment_penalty?: string | null
  amortization_schedule?: string | null
  first_payment_date?: string | null

  // Borrower / Guarantor
  coborrower_name?: string | null
  coborrower_phone?: string | null
  coborrower_email?: string | null
  experience_borrower?: string | null
  experience_coborrower?: string | null
  experience_notes?: string | null
  number_of_properties?: number | null
  verified_assets?: string | null

  // Credit / Background
  credit_report_date?: string | null
  credit_score?: number | null
  background_check_date?: string | null
  credit_background_notes?: string | null

  // Appraisal / Review Tracking
  appraisal_received_date?: string | null
  appraisal_effective_date?: string | null

  // Valuation / Collateral
  purchase_price?: number | null
  acquisition_date?: string | null
  value_as_is?: number | null
  value_bpo?: number | null
  payoff?: number | null

  // Construction / Rehab
  construction_holdback?: number | null
  draw_fee?: number | null

  // DSCR inputs
  qualifying_rent?: number | null
  annual_insurance_premium?: number | null
  annual_property_tax?: number | null
  annual_flood_insurance?: number | null
  annual_hoa_dues?: number | null

  // JotForm-sourced — Property Info additions
  square_footage?: number | null
  units_vacant?: boolean | null

  // JotForm-sourced — Loan Type I
  loan_type_one?: string | null

  // JotForm-sourced — Borrower financial summary
  liquid_assets_total?: number | null

  // JotForm-sourced — Self-reported credit
  credit_score_estimate?: number | null
  credit_frozen?: boolean | null

  // JotForm-sourced — Application Profile
  own_or_rent?: string | null
  mortgage_on_primary?: boolean | null
  intent_to_occupy?: boolean | null
  down_payment_borrowed?: boolean | null

  // JotForm-sourced — Title & Insurance
  title_company?: string | null
  title_email?: string | null
  title_phone?: string | null
  insurance_company?: string | null
  insurance_email?: string | null
  insurance_phone?: string | null

  // JotForm-sourced — Vesting Entity
  vesting_in_entity?: boolean | null
  entity_type?: string | null
  entity_formation_state?: string | null

  // JotForm-sourced — Declarations bundle (read-only display)
  declarations?: {
    outstanding_judgements?: boolean | null
    bankruptcy_or_foreclosure?: boolean | null
    delinquent_debt?: boolean | null
    delinquent_federal_debt?: boolean | null
    party_to_lawsuit?: boolean | null
    landlord_action?: boolean | null
    down_payment_borrowed?: boolean | null
    foreign_national?: boolean | null
    intent_to_occupy?: boolean | null
    explanation?: string | null
  } | null
}

interface Props {
  loanId: string
  loanCreatedAt: string
  details: LoanDetails | null
  /** From the loans table — used to calculate Monthly Payment. */
  loanAmount?: number | null
  interestRate?: number | null
  termMonths?: number | null
  /** Pipedrive's "Yes" / "No" for the interest-only flag. */
  interestOnly?: string | null
  /** From the loans table — mirrored under Valuation / Collateral as Value (ARV). */
  loanArv?: number | null
  /** Default-open behavior for the whole card. Defaults to false (collapsed). */
  defaultOpen?: boolean
}

const URGENCY_OPTIONS = ['Low', 'Medium', 'High', 'Urgent'] as const
const PROPERTY_TYPE_OPTIONS = ['SFR', '2-4 Unit', 'Multifamily', 'Condo', 'Townhouse', 'Mixed Use', 'Commercial'] as const
const RATE_TYPE_OPTIONS = ['Fixed', 'ARM'] as const
const AMORTIZATION_OPTIONS = ['Interest Only', '15-yr', '20-yr', '25-yr', '30-yr'] as const
const LOAN_TYPE_ONE_OPTIONS = ['Purchase', 'Refinance (no cash out)', 'Refinance (cash out)', 'Delayed Purchase'] as const
const OWN_OR_RENT_OPTIONS = ['Own', 'Rent'] as const
const ENTITY_TYPE_OPTIONS = ['LLC', 'Inc'] as const

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const currencyFmtCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  return currencyFmt.format(val)
}

/**
 * Monthly payment calculator.
 *  - Interest-only: principal × monthly rate
 *  - Amortizing:    P × r(1+r)^n / ((1+r)^n − 1)
 *
 * Treats either `interest_only === 'Yes'` (Loan Summary, Pipedrive-synced)
 * OR `amortization_schedule === 'Interest Only'` (Loan Details) as
 * interest-only. Common case: a JotForm bridge loan sets the latter
 * but not the former, and we still want the right number.
 *
 * Returns null if any required input is missing or if amortizing math
 * is degenerate.
 */
function calcMonthlyPayment(
  amount: number | null | undefined,
  ratePct: number | null | undefined,
  termMonths: number | null | undefined,
  interestOnly: string | null | undefined,
  amortizationSchedule: string | null | undefined,
): number | null {
  if (!amount || !ratePct) return null
  const r = ratePct / 100 / 12
  const isInterestOnly =
    interestOnly === 'Yes' || amortizationSchedule === 'Interest Only'
  if (isInterestOnly) return amount * r
  if (!termMonths || termMonths <= 0) return null
  if (r === 0) return amount / termMonths
  const factor = Math.pow(1 + r, termMonths)
  return (amount * r * factor) / (factor - 1)
}

/**
 * How many days remain in a fixed validity window from a given start date.
 * Returns null if the start date is missing or malformed.
 */
function daysLeft(startDate: string | null | undefined, windowDays: number): number | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null
  const [y, m, d] = startDate.split('-').map(Number)
  const start = new Date(y, m - 1, d).getTime()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const elapsed = Math.floor((today.getTime() - start) / 86_400_000)
  return windowDays - elapsed
}

/**
 * DSCR (Debt Service Coverage Ratio).
 *   annual revenue = qualifying_rent × 12
 *   annual debt    = monthly_payment × 12 + property_tax + insurance + flood + hoa
 *   DSCR           = annual_revenue / annual_debt
 * Returns null if rent or monthly payment is missing, or if annual debt is zero.
 */
function calcDSCR(
  qualifyingRent: number | null | undefined,
  monthlyPayment: number | null,
  annualPropertyTax: number | null | undefined,
  annualInsurance: number | null | undefined,
  annualFlood: number | null | undefined,
  annualHoa: number | null | undefined,
): number | null {
  if (!qualifyingRent || qualifyingRent <= 0) return null
  if (monthlyPayment === null || monthlyPayment <= 0) return null
  const annualRevenue = qualifyingRent * 12
  const annualDebt =
    monthlyPayment * 12
    + (annualPropertyTax ?? 0)
    + (annualInsurance ?? 0)
    + (annualFlood ?? 0)
    + (annualHoa ?? 0)
  if (annualDebt <= 0) return null
  return annualRevenue / annualDebt
}

/** Color-coded pill for a DSCR ratio. Thresholds: ≥1.0 green, 0.75–0.99 amber, <0.75 red. */
function DSCRBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>
  let cls: string
  if (value >= 1.0) cls = 'bg-emerald-50 text-emerald-700 border-emerald-200'
  else if (value >= 0.75) cls = 'bg-amber-50 text-amber-700 border-amber-200'
  else cls = 'bg-red-50 text-red-700 border-red-200'
  return (
    <span className={`inline-block text-sm font-semibold px-2 py-0.5 rounded border ${cls}`}>
      {value.toFixed(2)}
    </span>
  )
}

/** Color-coded pill for a "days left" countdown. */
function DaysLeftBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>

  let label: string
  let cls: string
  if (value < 0) {
    label = `Expired ${Math.abs(value)} day${Math.abs(value) === 1 ? '' : 's'} ago`
    cls = 'bg-red-50 text-red-700 border-red-200'
  } else if (value === 0) {
    label = 'Expires today'
    cls = 'bg-red-50 text-red-700 border-red-200'
  } else if (value <= 14) {
    label = `${value} day${value === 1 ? '' : 's'} left`
    cls = 'bg-amber-50 text-amber-700 border-amber-200'
  } else {
    label = `${value} days left`
    cls = 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  )
}

/**
 * Editable loan details — fields that don't sync to Pipedrive but live
 * portal-side for LO / LP / UW to populate. Renders as a collapsible card
 * with sub-sections that can each be expanded independently.
 */
export function LoanDetailsCard({
  loanId,
  loanCreatedAt,
  details,
  loanAmount,
  interestRate,
  termMonths,
  interestOnly,
  loanArv,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const d = details ?? {}

  const monthly = calcMonthlyPayment(loanAmount, interestRate, termMonths, interestOnly, d.amortization_schedule)
  const dscr = calcDSCR(
    d.qualifying_rent,
    monthly,
    d.annual_property_tax,
    d.annual_insurance_premium,
    d.annual_flood_insurance,
    d.annual_hoa_dues,
  )

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full text-left"
      >
        <CardHeader className="flex flex-row items-center justify-between gap-3 hover:bg-gray-50 transition-colors rounded-t-lg">
          <CardTitle className="text-base">Loan Details</CardTitle>
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`}
          />
        </CardHeader>
      </button>

      {open && (
        <CardContent className="space-y-3">
          <Section title="Loan / Deal Overview" defaultOpen>
            <DetailRow label="Created">
              <span className="font-medium text-gray-700">{formatDate(loanCreatedAt)}</span>
            </DetailRow>
            <DetailRow label="Submitted">
              <EditableLoanField
                loanId={loanId}
                field="submitted_at"
                type="date"
                currentValue={d.submitted_at ?? null}
                display={formatDate(d.submitted_at)}
              />
            </DetailRow>
            <DetailRow label="Investor Loan Number">
              <EditableLoanField
                loanId={loanId}
                field="investor_loan_number"
                type="text"
                currentValue={d.investor_loan_number ?? null}
                display={d.investor_loan_number ?? '—'}
              />
            </DetailRow>
            <DetailRow label="Loan Application">
              <EditableLoanField
                loanId={loanId}
                field="loan_application"
                type="text"
                currentValue={d.loan_application ?? null}
                display={d.loan_application ?? '—'}
                inputWidthClass="w-48"
              />
            </DetailRow>
            <DetailRow label="Urgency">
              <EditableLoanField
                loanId={loanId}
                field="urgency"
                type="enum"
                options={URGENCY_OPTIONS}
                currentValue={d.urgency ?? null}
                display={d.urgency ?? '—'}
              />
            </DetailRow>
            <DetailRow label="Cross Collateralization">
              <EditableLoanField
                loanId={loanId}
                field="cross_collateralization"
                type="boolean"
                currentValue={d.cross_collateralization ?? false}
              />
            </DetailRow>
            <DetailRow label="Foreign National">
              <EditableLoanField
                loanId={loanId}
                field="foreign_national"
                type="boolean"
                currentValue={d.foreign_national ?? false}
              />
            </DetailRow>

            <Stacked label="Reason Canceled">
              <EditableLoanField
                loanId={loanId}
                field="reason_canceled"
                type="textarea"
                currentValue={d.reason_canceled ?? null}
                placeholder="If canceled, document the reason"
              />
            </Stacked>
            <Stacked label="Underwriter's Notes">
              <EditableLoanField
                loanId={loanId}
                field="underwriter_notes"
                type="textarea"
                currentValue={d.underwriter_notes ?? null}
                placeholder="Underwriting notes"
              />
            </Stacked>
            <Stacked label="Exceptions">
              <EditableLoanField
                loanId={loanId}
                field="exceptions"
                type="textarea"
                currentValue={d.exceptions ?? null}
                placeholder="Any approved exceptions"
              />
            </Stacked>
          </Section>

          <Section title="Property Information">
            <DetailRow label="Street">
              <EditableLoanField
                loanId={loanId}
                field="property_street"
                type="text"
                currentValue={d.property_street ?? null}
                display={d.property_street ?? '—'}
                inputWidthClass="w-48"
              />
            </DetailRow>
            <DetailRow label="City">
              <EditableLoanField
                loanId={loanId}
                field="property_city"
                type="text"
                currentValue={d.property_city ?? null}
                display={d.property_city ?? '—'}
              />
            </DetailRow>
            <DetailRow label="State">
              <EditableLoanField
                loanId={loanId}
                field="property_state"
                type="text"
                currentValue={d.property_state ?? null}
                display={d.property_state ?? '—'}
                inputWidthClass="w-20"
              />
            </DetailRow>
            <DetailRow label="ZIP">
              <EditableLoanField
                loanId={loanId}
                field="property_zip"
                type="text"
                currentValue={d.property_zip ?? null}
                display={d.property_zip ?? '—'}
                inputWidthClass="w-24"
              />
            </DetailRow>
            <DetailRow label="Property Type">
              <EditableLoanField
                loanId={loanId}
                field="property_type"
                type="enum"
                options={PROPERTY_TYPE_OPTIONS}
                currentValue={d.property_type ?? null}
                display={d.property_type ?? '—'}
              />
            </DetailRow>
            <DetailRow label="Number of Units">
              <EditableLoanField
                loanId={loanId}
                field="number_of_units"
                type="number"
                currentValue={d.number_of_units ?? null}
                display={d.number_of_units ?? '—'}
                placeholder="1"
                step="1"
                inputWidthClass="w-20"
              />
            </DetailRow>
            <DetailRow label="Square Footage">
              <EditableLoanField
                loanId={loanId}
                field="square_footage"
                type="number"
                currentValue={d.square_footage ?? null}
                display={d.square_footage ?? '—'}
                placeholder="1500"
                step="1"
                inputWidthClass="w-24"
              />
            </DetailRow>
            <DetailRow label="Vacant Units">
              <EditableLoanField
                loanId={loanId}
                field="units_vacant"
                type="boolean"
                currentValue={d.units_vacant ?? false}
              />
            </DetailRow>
            <DetailRow label="Flood Zone">
              <EditableLoanField
                loanId={loanId}
                field="flood_zone"
                type="text"
                currentValue={d.flood_zone ?? null}
                display={d.flood_zone ?? '—'}
              />
            </DetailRow>
          </Section>

          <Section title="Loan Terms">
            <DetailRow label="Loan Type I">
              <EditableLoanField
                loanId={loanId}
                field="loan_type_one"
                type="enum"
                options={LOAN_TYPE_ONE_OPTIONS}
                currentValue={d.loan_type_one ?? null}
                display={d.loan_type_one ?? '—'}
                inputWidthClass="w-48"
              />
            </DetailRow>
            <DetailRow label="Initial Loan Amount">
              <EditableLoanField
                loanId={loanId}
                field="initial_loan_amount"
                type="currency"
                currentValue={d.initial_loan_amount ?? null}
                display={formatCurrency(d.initial_loan_amount)}
                placeholder="500000"
              />
            </DetailRow>
            <DetailRow label="Cash-Out Amount">
              <EditableLoanField
                loanId={loanId}
                field="cash_out_amount"
                type="currency"
                currentValue={d.cash_out_amount ?? null}
                display={formatCurrency(d.cash_out_amount)}
                placeholder="0"
              />
            </DetailRow>
            <DetailRow label="Rate Type">
              <EditableLoanField
                loanId={loanId}
                field="rate_type"
                type="enum"
                options={RATE_TYPE_OPTIONS}
                currentValue={d.rate_type ?? null}
                display={d.rate_type ?? '—'}
              />
            </DetailRow>
            <DetailRow label="Points">
              <EditableLoanField
                loanId={loanId}
                field="points"
                type="number"
                currentValue={d.points ?? null}
                display={d.points !== null && d.points !== undefined ? String(d.points) : '—'}
                placeholder="2"
                step="0.01"
                inputWidthClass="w-24"
              />
            </DetailRow>
            <DetailRow label="Broker Points">
              <EditableLoanField
                loanId={loanId}
                field="broker_points"
                type="number"
                currentValue={d.broker_points ?? null}
                display={d.broker_points !== null && d.broker_points !== undefined ? String(d.broker_points) : '—'}
                placeholder="1"
                step="0.01"
                inputWidthClass="w-24"
              />
            </DetailRow>
            <DetailRow label="Underwriting Fee">
              <EditableLoanField
                loanId={loanId}
                field="underwriting_fee"
                type="currency"
                currentValue={d.underwriting_fee ?? null}
                display={formatCurrency(d.underwriting_fee)}
                placeholder="1500"
              />
            </DetailRow>
            <DetailRow label="Legal/Doc Prep Fee">
              <EditableLoanField
                loanId={loanId}
                field="legal_doc_prep_fee"
                type="currency"
                currentValue={d.legal_doc_prep_fee ?? null}
                display={formatCurrency(d.legal_doc_prep_fee)}
                placeholder="850"
              />
            </DetailRow>
            <DetailRow label="Prepayment Penalty">
              <EditableLoanField
                loanId={loanId}
                field="prepayment_penalty"
                type="text"
                currentValue={d.prepayment_penalty ?? null}
                display={d.prepayment_penalty ?? '—'}
                inputWidthClass="w-48"
              />
            </DetailRow>
            <DetailRow label="Amortization Schedule">
              <EditableLoanField
                loanId={loanId}
                field="amortization_schedule"
                type="enum"
                options={AMORTIZATION_OPTIONS}
                currentValue={d.amortization_schedule ?? null}
                display={d.amortization_schedule ?? '—'}
              />
            </DetailRow>
            <DetailRow label="First Payment Date">
              <EditableLoanField
                loanId={loanId}
                field="first_payment_date"
                type="date"
                currentValue={d.first_payment_date ?? null}
                display={formatDate(d.first_payment_date)}
              />
            </DetailRow>

            {/* Calculated, read-only — pulls from the Loan Summary fields */}
            <div className="flex justify-between items-center gap-3 pt-2 mt-1 border-t border-gray-100">
              <span className="text-gray-500 flex items-center gap-1.5">
                Monthly Payment
                <span className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">calc</span>
              </span>
              <span className="font-semibold text-gray-900">
                {monthly !== null ? currencyFmtCents.format(monthly) : '—'}
              </span>
            </div>
            {monthly === null && (loanAmount || interestRate || termMonths) && (
              <p className="text-xs text-gray-400 italic">
                Needs Loan Amount + Interest Rate from the Loan Summary, plus either a Term, an Interest Only = Yes flag, or Amortization Schedule = Interest Only.
              </p>
            )}
          </Section>

          <Section title="Title & Insurance">
            <DetailRow label="Title Company / Agent">
              <EditableLoanField
                loanId={loanId}
                field="title_company"
                type="text"
                currentValue={d.title_company ?? null}
                display={d.title_company ?? '—'}
                inputWidthClass="w-56"
              />
            </DetailRow>
            <DetailRow label="Title Email">
              <EditableLoanField
                loanId={loanId}
                field="title_email"
                type="text"
                currentValue={d.title_email ?? null}
                display={d.title_email ?? '—'}
                inputWidthClass="w-56"
              />
            </DetailRow>
            <DetailRow label="Title Phone">
              <EditableLoanField
                loanId={loanId}
                field="title_phone"
                type="text"
                currentValue={d.title_phone ?? null}
                display={d.title_phone ?? '—'}
              />
            </DetailRow>
            <DetailRow label="Insurance Company / Agent">
              <EditableLoanField
                loanId={loanId}
                field="insurance_company"
                type="text"
                currentValue={d.insurance_company ?? null}
                display={d.insurance_company ?? '—'}
                inputWidthClass="w-56"
              />
            </DetailRow>
            <DetailRow label="Insurance Email">
              <EditableLoanField
                loanId={loanId}
                field="insurance_email"
                type="text"
                currentValue={d.insurance_email ?? null}
                display={d.insurance_email ?? '—'}
                inputWidthClass="w-56"
              />
            </DetailRow>
            <DetailRow label="Insurance Phone">
              <EditableLoanField
                loanId={loanId}
                field="insurance_phone"
                type="text"
                currentValue={d.insurance_phone ?? null}
                display={d.insurance_phone ?? '—'}
              />
            </DetailRow>
          </Section>

          <Section title="Vesting Entity">
            <DetailRow label="Vesting in Entity?">
              <EditableLoanField
                loanId={loanId}
                field="vesting_in_entity"
                type="boolean"
                currentValue={d.vesting_in_entity ?? false}
              />
            </DetailRow>
            <DetailRow label="Entity Type">
              <EditableLoanField
                loanId={loanId}
                field="entity_type"
                type="enum"
                options={ENTITY_TYPE_OPTIONS}
                currentValue={d.entity_type ?? null}
                display={d.entity_type ?? '—'}
              />
            </DetailRow>
            <DetailRow label="Formation State">
              <EditableLoanField
                loanId={loanId}
                field="entity_formation_state"
                type="text"
                currentValue={d.entity_formation_state ?? null}
                display={d.entity_formation_state ?? '—'}
                inputWidthClass="w-20"
              />
            </DetailRow>
            <p className="text-xs text-gray-400 italic">
              Entity name itself is in the Loan Summary above (it syncs to Pipedrive).
            </p>
          </Section>

          <Section title="Borrower / Guarantor">
            <DetailRow label="Co-Borrower Name">
              <EditableLoanField
                loanId={loanId}
                field="coborrower_name"
                type="text"
                currentValue={d.coborrower_name ?? null}
                display={d.coborrower_name ?? '—'}
                inputWidthClass="w-48"
              />
            </DetailRow>
            <DetailRow label="Co-Borrower Phone">
              <EditableLoanField
                loanId={loanId}
                field="coborrower_phone"
                type="text"
                currentValue={d.coborrower_phone ?? null}
                display={d.coborrower_phone ?? '—'}
              />
            </DetailRow>
            <DetailRow label="Co-Borrower Email">
              <EditableLoanField
                loanId={loanId}
                field="coborrower_email"
                type="text"
                currentValue={d.coborrower_email ?? null}
                display={d.coborrower_email ?? '—'}
                inputWidthClass="w-56"
              />
            </DetailRow>
            <DetailRow label="Borrower Experience">
              <EditableLoanField
                loanId={loanId}
                field="experience_borrower"
                type="text"
                currentValue={d.experience_borrower ?? null}
                display={d.experience_borrower ?? '—'}
                inputWidthClass="w-48"
                placeholder="e.g. 12 flips"
              />
            </DetailRow>
            <DetailRow label="Co-Borrower Experience">
              <EditableLoanField
                loanId={loanId}
                field="experience_coborrower"
                type="text"
                currentValue={d.experience_coborrower ?? null}
                display={d.experience_coborrower ?? '—'}
                inputWidthClass="w-48"
                placeholder="e.g. 5 rentals"
              />
            </DetailRow>
            <DetailRow label="Number of Properties">
              <EditableLoanField
                loanId={loanId}
                field="number_of_properties"
                type="number"
                currentValue={d.number_of_properties ?? null}
                display={d.number_of_properties ?? '—'}
                step="1"
                inputWidthClass="w-20"
              />
            </DetailRow>
            <DetailRow label="Verified Assets">
              <EditableLoanField
                loanId={loanId}
                field="verified_assets"
                type="text"
                currentValue={d.verified_assets ?? null}
                display={d.verified_assets ?? '—'}
                inputWidthClass="w-48"
                placeholder="e.g. $250k"
              />
            </DetailRow>
            <DetailRow label="Liquid Assets Total">
              <EditableLoanField
                loanId={loanId}
                field="liquid_assets_total"
                type="currency"
                currentValue={d.liquid_assets_total ?? null}
                display={formatCurrency(d.liquid_assets_total)}
                placeholder="250000"
              />
            </DetailRow>

            <Stacked label="Experience Notes">
              <EditableLoanField
                loanId={loanId}
                field="experience_notes"
                type="textarea"
                currentValue={d.experience_notes ?? null}
                placeholder="Any additional context on borrower / co-borrower experience"
              />
            </Stacked>
          </Section>

          <Section title="Application Profile">
            <DetailRow label="Own or Rent (current home)">
              <EditableLoanField
                loanId={loanId}
                field="own_or_rent"
                type="enum"
                options={OWN_OR_RENT_OPTIONS}
                currentValue={d.own_or_rent ?? null}
                display={d.own_or_rent ?? '—'}
                inputWidthClass="w-24"
              />
            </DetailRow>
            <DetailRow label="Mortgage on Primary Residence">
              <EditableLoanField
                loanId={loanId}
                field="mortgage_on_primary"
                type="boolean"
                currentValue={d.mortgage_on_primary ?? false}
              />
            </DetailRow>
            <DetailRow label="Intent to Occupy Subject Property">
              <EditableLoanField
                loanId={loanId}
                field="intent_to_occupy"
                type="boolean"
                currentValue={d.intent_to_occupy ?? false}
              />
            </DetailRow>
            <DetailRow label="Down Payment Borrowed">
              <EditableLoanField
                loanId={loanId}
                field="down_payment_borrowed"
                type="boolean"
                currentValue={d.down_payment_borrowed ?? false}
              />
            </DetailRow>
          </Section>

          <Section title="Credit / Background">
            <DetailRow label="Credit Score (Estimate)">
              <EditableLoanField
                loanId={loanId}
                field="credit_score_estimate"
                type="number"
                currentValue={d.credit_score_estimate ?? null}
                display={d.credit_score_estimate ?? '—'}
                placeholder="720"
                step="1"
                inputWidthClass="w-24"
              />
            </DetailRow>
            <DetailRow label="Credit Frozen">
              <EditableLoanField
                loanId={loanId}
                field="credit_frozen"
                type="boolean"
                currentValue={d.credit_frozen ?? false}
              />
            </DetailRow>
            <DetailRow label="Credit Report Date">
              <EditableLoanField
                loanId={loanId}
                field="credit_report_date"
                type="date"
                currentValue={d.credit_report_date ?? null}
                display={formatDate(d.credit_report_date)}
              />
            </DetailRow>
            <DetailRow label="Credit Score (Pulled)">
              <EditableLoanField
                loanId={loanId}
                field="credit_score"
                type="number"
                currentValue={d.credit_score ?? null}
                display={d.credit_score ?? '—'}
                placeholder="720"
                step="1"
                inputWidthClass="w-24"
              />
            </DetailRow>
            <DetailRow label="Background Check Date">
              <EditableLoanField
                loanId={loanId}
                field="background_check_date"
                type="date"
                currentValue={d.background_check_date ?? null}
                display={formatDate(d.background_check_date)}
              />
            </DetailRow>

            {/* 90-day validity countdown — calculated, read-only */}
            <div className="flex justify-between items-center gap-3 pt-2 mt-1 border-t border-gray-100">
              <span className="text-gray-500 flex items-center gap-1.5">
                Credit Days Left
                <span className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">calc</span>
              </span>
              <DaysLeftBadge value={daysLeft(d.credit_report_date, 90)} />
            </div>
            {!d.credit_report_date && (
              <p className="text-xs text-gray-400 italic">
                Set Credit Report Date above to start the 90-day countdown.
              </p>
            )}

            <Stacked label="Credit / Background Notes">
              <EditableLoanField
                loanId={loanId}
                field="credit_background_notes"
                type="textarea"
                currentValue={d.credit_background_notes ?? null}
                placeholder="Notes from credit pull or background check"
              />
            </Stacked>
          </Section>

          <Section title="Appraisal / Review Tracking">
            <DetailRow label="Appraisal Received Date">
              <EditableLoanField
                loanId={loanId}
                field="appraisal_received_date"
                type="date"
                currentValue={d.appraisal_received_date ?? null}
                display={formatDate(d.appraisal_received_date)}
              />
            </DetailRow>
            <DetailRow label="Appraisal Effective Date">
              <EditableLoanField
                loanId={loanId}
                field="appraisal_effective_date"
                type="date"
                currentValue={d.appraisal_effective_date ?? null}
                display={formatDate(d.appraisal_effective_date)}
              />
            </DetailRow>

            {/* 120-day validity countdown — calculated, read-only */}
            <div className="flex justify-between items-center gap-3 pt-2 mt-1 border-t border-gray-100">
              <span className="text-gray-500 flex items-center gap-1.5">
                Appraisal Days Left
                <span className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">calc</span>
              </span>
              <DaysLeftBadge value={daysLeft(d.appraisal_received_date, 120)} />
            </div>
            {!d.appraisal_received_date && (
              <p className="text-xs text-gray-400 italic">
                Set Appraisal Received Date above to start the 120-day countdown.
              </p>
            )}
          </Section>

          <Section title="Valuation / Collateral">
            <DetailRow label="Purchase Price">
              <EditableLoanField
                loanId={loanId}
                field="purchase_price"
                type="currency"
                currentValue={d.purchase_price ?? null}
                display={formatCurrency(d.purchase_price)}
                placeholder="450000"
              />
            </DetailRow>
            <DetailRow label="Acquisition Date">
              <EditableLoanField
                loanId={loanId}
                field="acquisition_date"
                type="date"
                currentValue={d.acquisition_date ?? null}
                display={formatDate(d.acquisition_date)}
              />
            </DetailRow>
            <DetailRow label="Value (As-Is)">
              <EditableLoanField
                loanId={loanId}
                field="value_as_is"
                type="currency"
                currentValue={d.value_as_is ?? null}
                display={formatCurrency(d.value_as_is)}
                placeholder="475000"
              />
            </DetailRow>
            <DetailRow label="Value (ARV)">
              <EditableLoanField
                loanId={loanId}
                field="arv"
                type="currency"
                currentValue={loanArv ?? null}
                display={formatCurrency(loanArv ?? null)}
                placeholder="600000"
              />
            </DetailRow>
            <DetailRow label="Value (BPO)">
              <EditableLoanField
                loanId={loanId}
                field="value_bpo"
                type="currency"
                currentValue={d.value_bpo ?? null}
                display={formatCurrency(d.value_bpo)}
                placeholder="470000"
              />
            </DetailRow>
            <DetailRow label="Payoff">
              <EditableLoanField
                loanId={loanId}
                field="payoff"
                type="currency"
                currentValue={d.payoff ?? null}
                display={formatCurrency(d.payoff)}
                placeholder="200000"
              />
            </DetailRow>
          </Section>

          <Section title="Construction / Rehab">
            <DetailRow label="Construction Holdback">
              <EditableLoanField
                loanId={loanId}
                field="construction_holdback"
                type="currency"
                currentValue={d.construction_holdback ?? null}
                display={formatCurrency(d.construction_holdback)}
                placeholder="50000"
              />
            </DetailRow>
            <DetailRow label="Draw Fee">
              <EditableLoanField
                loanId={loanId}
                field="draw_fee"
                type="currency"
                currentValue={d.draw_fee ?? null}
                display={formatCurrency(d.draw_fee)}
                placeholder="250"
              />
            </DetailRow>
          </Section>

          <Section title="DSCR">
            <DetailRow label="Qualifying Rent (monthly)">
              <EditableLoanField
                loanId={loanId}
                field="qualifying_rent"
                type="currency"
                currentValue={d.qualifying_rent ?? null}
                display={formatCurrency(d.qualifying_rent)}
                placeholder="3500"
              />
            </DetailRow>
            <DetailRow label="Annual Property Tax">
              <EditableLoanField
                loanId={loanId}
                field="annual_property_tax"
                type="currency"
                currentValue={d.annual_property_tax ?? null}
                display={formatCurrency(d.annual_property_tax)}
                placeholder="6000"
              />
            </DetailRow>
            <DetailRow label="Annual Insurance Premium">
              <EditableLoanField
                loanId={loanId}
                field="annual_insurance_premium"
                type="currency"
                currentValue={d.annual_insurance_premium ?? null}
                display={formatCurrency(d.annual_insurance_premium)}
                placeholder="1800"
              />
            </DetailRow>
            <DetailRow label="Annual Flood Insurance">
              <EditableLoanField
                loanId={loanId}
                field="annual_flood_insurance"
                type="currency"
                currentValue={d.annual_flood_insurance ?? null}
                display={formatCurrency(d.annual_flood_insurance)}
                placeholder="0"
              />
            </DetailRow>
            <DetailRow label="Annual HOA Dues">
              <EditableLoanField
                loanId={loanId}
                field="annual_hoa_dues"
                type="currency"
                currentValue={d.annual_hoa_dues ?? null}
                display={formatCurrency(d.annual_hoa_dues)}
                placeholder="0"
              />
            </DetailRow>

            {/* Calculated DSCR — pulls monthly payment from Loan Summary calc above */}
            <div className="flex justify-between items-center gap-3 pt-2 mt-1 border-t border-gray-100">
              <span className="text-gray-500 flex items-center gap-1.5">
                DSCR
                <span className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">calc</span>
              </span>
              <DSCRBadge value={dscr} />
            </div>
            {dscr === null && (
              <p className="text-xs text-gray-400 italic">
                Needs Qualifying Rent here, plus Loan Amount + Interest Rate + Term (or Interest Only = Yes) in the Loan Summary.
              </p>
            )}
          </Section>

          <Section title="Declarations">
            <p className="text-xs text-gray-500 italic mb-1">
              Captured from the loan application; read-only. &ldquo;Yes&rdquo; answers
              are flagged for underwriter review.
            </p>
            <DeclarationRow label="Outstanding judgements" value={d.declarations?.outstanding_judgements} />
            <DeclarationRow label="Bankruptcy or foreclosure (last 7 yrs)" value={d.declarations?.bankruptcy_or_foreclosure} />
            <DeclarationRow label="Currently delinquent on debt" value={d.declarations?.delinquent_debt} />
            <DeclarationRow label="Delinquent on Federal debt" value={d.declarations?.delinquent_federal_debt} />
            <DeclarationRow label="Party to current lawsuit" value={d.declarations?.party_to_lawsuit} />
            <DeclarationRow label="Prior landlord action / eviction" value={d.declarations?.landlord_action} />
            <DeclarationRow label="Down payment borrowed" value={d.declarations?.down_payment_borrowed} />
            <DeclarationRow label="Foreign national" value={d.declarations?.foreign_national} />
            <DeclarationRow label="Intends to occupy subject property" value={d.declarations?.intent_to_occupy} flagOnYes={false} />
            {d.declarations?.explanation && (
              <div className="pt-2 mt-1 border-t border-gray-100">
                <p className="text-gray-500 text-xs mb-1">Applicant&apos;s explanation</p>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{d.declarations.explanation}</p>
              </div>
            )}
          </Section>
        </CardContent>
      )}
    </Card>
  )
}

/**
 * Read-only row for a yes/no declaration. Defaults to flagging "Yes" answers
 * (red) since most declarations describe potentially concerning scenarios;
 * pass `flagOnYes={false}` for declarations where Yes is benign.
 */
function DeclarationRow({
  label,
  value,
  flagOnYes = true,
}: {
  label: string
  value: boolean | null | undefined
  flagOnYes?: boolean
}) {
  let display: React.ReactNode
  if (value === null || value === undefined) {
    display = <span className="text-gray-400">—</span>
  } else if (value === true) {
    display = (
      <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${
        flagOnYes ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}>
        Yes
      </span>
    )
  } else {
    display = (
      <span className="text-xs font-medium px-2 py-0.5 rounded border bg-gray-50 text-gray-600 border-gray-200">
        No
      </span>
    )
  }
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-gray-500">{label}</span>
      {display}
    </div>
  )
}

/** Collapsible sub-section inside the Loan Details card. */
function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <div className="px-3 py-3 space-y-2 text-sm">{children}</div>
      )}
    </div>
  )
}

/** Two-column row for compact fields. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-gray-500">{label}</span>
      {children}
    </div>
  )
}

/** Stacked label / value, used for textareas that need width. */
function Stacked({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-gray-500 block">{label}</span>
      {children}
    </div>
  )
}
