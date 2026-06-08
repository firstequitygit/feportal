'use client'

import { useState, useContext, createContext, useEffect, useRef } from 'react'
import { ChevronDown, Filter, Check, Star } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EditableLoanField } from '@/components/editable-loan-field'
import { formatDate } from '@/lib/format-date'
import { LoanDetailViewsManager, type LoanDetailView } from '@/components/loan-detail-views-manager'

/** Shape of the loan_details row. All fields nullable / optional. */
export interface LoanDetails {
  // Loan / Deal Overview
  investor_loan_number?: string | null
  min_number?: string | null
  funded_date?: string | null
  loan_application?: string | null
  submitted_at?: string | null
  urgency?: string | null
  investor?: string | null
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
  broker_ysp?: number | null
  rate_costs_points?: number | null
  other_exception_costs_points?: number | null
  desk_review_fee?: number | null
  small_balance_fee?: number | null
  feasibility_fee?: number | null
  additional_fees?: number | null
  additional_fees_notes?: string | null
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
  appraisal_order_date?: string | null
  appraisal_received_date?: string | null
  appraisal_effective_date?: string | null
  appraisal_paid_date?: string | null

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

  // JotForm-sourced — Loan Purpose (column is historically named loan_type_one)
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

  // JotForm-sourced — Title, Insurance, Appraiser
  title_company?: string | null
  title_email?: string | null
  title_phone?: string | null
  insurance_company?: string | null
  insurance_email?: string | null
  insurance_phone?: string | null
  appraisal_company?: string | null
  appraisal_email?: string | null
  appraisal_phone?: string | null

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
  /** From the loans table — shown in the Loan / Deal Overview section
   *  alongside the loan_details-owned dates. The underlying columns
   *  live on `loans`, not `loan_details`, but the UI groups them here. */
  originationDate?: string | null
  maturityDate?: string | null
  /** Default-open behavior for the whole card. Defaults to false (collapsed). */
  defaultOpen?: boolean
  /** Saved views the current user owns. Empty = no saved views yet,
   *  picker still renders so they can open the manager and create
   *  one. */
  views?: LoanDetailView[]
  /** Id of the user's default view, or null. Drives which view is
   *  active on first render. */
  defaultViewId?: string | null
  /** Field keys hidden on first render — equals the default view's
   *  hidden_fields if a default exists, otherwise empty. The card
   *  keeps its own state after mount so the user can switch views
   *  without re-fetching from the server. */
  initialHiddenFields?: string[]
}

// ============================================================
// View-filter context
// ============================================================
//
// Shared by DetailRow / Stacked / Section so they can null-out
// themselves when the active view hides their field. Avoids
// prop-drilling 80 props from the card into every row.
interface ViewContextValue { hidden: Set<string> }
const ViewCtx = createContext<ViewContextValue>({ hidden: new Set() })

const URGENCY_OPTIONS = ['Low', 'Medium', 'High', 'Urgent'] as const
const INVESTOR_OPTIONS = [
  'Toorak', 'Churchill', 'Eastview', 'Silver', 'Blue', 'FE',
  'ROC', 'Corvest', 'Held', 'Logan Financial', 'DSCR', 'Verus',
] as const
const PROPERTY_TYPE_OPTIONS = ['SFR', '2-4 Unit', 'Multifamily', 'Condo', 'Townhouse', 'Mixed Use', 'Commercial'] as const
const RATE_TYPE_OPTIONS = ['Fixed', 'ARM'] as const
const AMORTIZATION_OPTIONS = ['Interest Only', '15-yr', '20-yr', '25-yr', '30-yr', '40-yr'] as const
const LOAN_TYPE_ONE_OPTIONS = ['Purchase', 'Refinance (no cash out)', 'Refinance (cash out)', 'Delayed Purchase'] as const
const OWN_OR_RENT_OPTIONS = ['Own', 'Rent'] as const
const ENTITY_TYPE_OPTIONS = ['LLC', 'Inc', 'Trust'] as const

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
  // Pipedrive / JotForm store interest rate inconsistently — some loans
  // have 7.75 (percent), others have 0.0775 (fraction). Hard-money rates
  // realistically sit between 5% and 15%, so anything < 1 is a fraction
  // that's already decimal-form; values >= 1 are still in percent form
  // and need /100. Same heuristic format-interest-rate.ts uses for display.
  const annualFraction = ratePct < 1 ? ratePct : ratePct / 100
  const r = annualFraction / 12
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
 *
 * Per-user saved views (passed in via `views` + `defaultViewId`) gate
 * which fields actually render. The picker in the card header lets
 * the user switch views or open the manager modal to create / edit
 * them. All filtering is client-side after the initial server-rendered
 * default — switching views doesn't refetch the loan.
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
  originationDate,
  maturityDate,
  defaultOpen = false,
  views = [],
  defaultViewId = null,
  initialHiddenFields = [],
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [savedViews, setSavedViews] = useState<LoanDetailView[]>(views)
  const [activeViewId, setActiveViewId] = useState<string | null>(defaultViewId)
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set(initialHiddenFields))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
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

  // Re-fetch the user's view list from the API. Called by the manager
  // modal after any CRUD action so the picker and the in-card filter
  // both update in place without a router.refresh().
  async function refreshViews() {
    const res = await fetch('/api/loan-detail-views')
    const data = await res.json().catch(() => null) as { views?: LoanDetailView[] } | null
    if (!data?.views) return
    const fresh = data.views
    setSavedViews(fresh)
    if (activeViewId) {
      const same = fresh.find(v => v.id === activeViewId)
      if (!same) {
        // Active view was deleted — fall back to default-or-none.
        const fallback = fresh.find(v => v.is_default) ?? null
        setActiveViewId(fallback?.id ?? null)
        setHiddenFields(new Set(fallback?.hidden_fields ?? []))
      } else {
        // Active view's hidden_fields may have changed — sync.
        setHiddenFields(new Set(same.hidden_fields))
      }
    } else {
      // No active view — adopt the new default if one was just set.
      const newDefault = fresh.find(v => v.is_default) ?? null
      if (newDefault) {
        setActiveViewId(newDefault.id)
        setHiddenFields(new Set(newDefault.hidden_fields))
      }
    }
  }

  function selectView(viewId: string | null) {
    setActiveViewId(viewId)
    if (viewId === null) {
      setHiddenFields(new Set())
    } else {
      const view = savedViews.find(v => v.id === viewId)
      setHiddenFields(new Set(view?.hidden_fields ?? []))
    }
    setPickerOpen(false)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 hover:bg-gray-50 transition-colors rounded-t-lg">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex-1 flex items-center justify-between text-left min-w-0"
        >
          <CardTitle className="text-base">Loan Details</CardTitle>
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ml-2 ${open ? '' : '-rotate-90'}`}
          />
        </button>
        <ViewPicker
          views={savedViews}
          activeViewId={activeViewId}
          onSelect={selectView}
          onManage={() => { setManagerOpen(true); setPickerOpen(false) }}
          open={pickerOpen}
          setOpen={setPickerOpen}
        />
      </CardHeader>

      {open && (
        <CardContent className="space-y-3">
          <ViewCtx.Provider value={{ hidden: hiddenFields }}>
            <Section title="Loan / Deal Overview">
              <DetailRow fieldKey="created_at" label="Created">
                <span className="font-medium text-gray-700">{formatDate(loanCreatedAt)}</span>
              </DetailRow>
              <DetailRow fieldKey="submitted_at" label="Submitted">
                <EditableLoanField
                  loanId={loanId}
                  field="submitted_at"
                  type="date"
                  currentValue={d.submitted_at ?? null}
                  display={formatDate(d.submitted_at)}
                />
              </DetailRow>
              {/* Origination + Maturity used to live in the Loan Summary
                  card; staff find them more useful here next to the
                  other deal-level dates. Columns still live on the
                  loans table — the values come in through props. */}
              <DetailRow fieldKey="origination_date" label="Origination Date">
                <EditableLoanField
                  loanId={loanId}
                  field="origination_date"
                  type="date"
                  currentValue={originationDate ?? null}
                  display={formatDate(originationDate)}
                />
              </DetailRow>
              <DetailRow fieldKey="maturity_date" label="Maturity Date">
                <EditableLoanField
                  loanId={loanId}
                  field="maturity_date"
                  type="date"
                  currentValue={maturityDate ?? null}
                  display={formatDate(maturityDate)}
                />
              </DetailRow>
              <DetailRow fieldKey="funded_date" label="Funded Date">
                <EditableLoanField
                  loanId={loanId}
                  field="funded_date"
                  type="date"
                  currentValue={d.funded_date ?? null}
                  display={formatDate(d.funded_date)}
                />
              </DetailRow>
              <DetailRow fieldKey="investor_loan_number" label="Investor Loan Number">
                <EditableLoanField
                  loanId={loanId}
                  field="investor_loan_number"
                  type="text"
                  currentValue={d.investor_loan_number ?? null}
                  display={d.investor_loan_number ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="min_number" label="MIN #">
                <EditableLoanField
                  loanId={loanId}
                  field="min_number"
                  type="text"
                  currentValue={d.min_number ?? null}
                  display={d.min_number ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="loan_application" label="Loan Application">
                <EditableLoanField
                  loanId={loanId}
                  field="loan_application"
                  type="text"
                  currentValue={d.loan_application ?? null}
                  display={d.loan_application ?? '—'}
                  inputWidthClass="w-48"
                />
              </DetailRow>
              <DetailRow fieldKey="urgency" label="Urgency">
                <EditableLoanField
                  loanId={loanId}
                  field="urgency"
                  type="enum"
                  options={URGENCY_OPTIONS}
                  currentValue={d.urgency ?? null}
                  display={d.urgency ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="investor" label="Investor">
                <EditableLoanField
                  loanId={loanId}
                  field="investor"
                  type="enum"
                  options={INVESTOR_OPTIONS}
                  currentValue={d.investor ?? null}
                  display={d.investor ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="cross_collateralization" label="Cross Collateralization">
                <EditableLoanField
                  loanId={loanId}
                  field="cross_collateralization"
                  type="boolean"
                  currentValue={d.cross_collateralization ?? false}
                />
              </DetailRow>
              <DetailRow fieldKey="foreign_national" label="Foreign National">
                <EditableLoanField
                  loanId={loanId}
                  field="foreign_national"
                  type="boolean"
                  currentValue={d.foreign_national ?? false}
                />
              </DetailRow>

              <Stacked fieldKey="reason_canceled" label="Reason Canceled">
                <EditableLoanField
                  loanId={loanId}
                  field="reason_canceled"
                  type="textarea"
                  currentValue={d.reason_canceled ?? null}
                  placeholder="If canceled, document the reason"
                />
              </Stacked>
              <Stacked fieldKey="underwriter_notes" label="Underwriter's Notes">
                <EditableLoanField
                  loanId={loanId}
                  field="underwriter_notes"
                  type="textarea"
                  currentValue={d.underwriter_notes ?? null}
                  placeholder="Underwriting notes"
                />
              </Stacked>
              <Stacked fieldKey="exceptions" label="Exceptions">
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
              <DetailRow fieldKey="property_street" label="Street">
                <EditableLoanField
                  loanId={loanId}
                  field="property_street"
                  type="text"
                  currentValue={d.property_street ?? null}
                  display={d.property_street ?? '—'}
                  inputWidthClass="w-48"
                />
              </DetailRow>
              <DetailRow fieldKey="property_city" label="City">
                <EditableLoanField
                  loanId={loanId}
                  field="property_city"
                  type="text"
                  currentValue={d.property_city ?? null}
                  display={d.property_city ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="property_state" label="State">
                <EditableLoanField
                  loanId={loanId}
                  field="property_state"
                  type="text"
                  currentValue={d.property_state ?? null}
                  display={d.property_state ?? '—'}
                  inputWidthClass="w-20"
                />
              </DetailRow>
              <DetailRow fieldKey="property_zip" label="ZIP">
                <EditableLoanField
                  loanId={loanId}
                  field="property_zip"
                  type="text"
                  currentValue={d.property_zip ?? null}
                  display={d.property_zip ?? '—'}
                  inputWidthClass="w-24"
                />
              </DetailRow>
              <DetailRow fieldKey="property_type" label="Property Type">
                <EditableLoanField
                  loanId={loanId}
                  field="property_type"
                  type="enum"
                  options={PROPERTY_TYPE_OPTIONS}
                  currentValue={d.property_type ?? null}
                  display={d.property_type ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="number_of_units" label="Number of Units">
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
              <DetailRow fieldKey="square_footage" label="Square Footage">
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
              <DetailRow fieldKey="units_vacant" label="Vacant Units">
                <EditableLoanField
                  loanId={loanId}
                  field="units_vacant"
                  type="boolean"
                  currentValue={d.units_vacant ?? false}
                />
              </DetailRow>
              <DetailRow fieldKey="flood_zone" label="Flood Zone">
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
              <DetailRow fieldKey="loan_type_one" label="Loan Purpose">
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
              <DetailRow fieldKey="initial_loan_amount" label="Initial Loan Amount">
                <EditableLoanField
                  loanId={loanId}
                  field="initial_loan_amount"
                  type="currency"
                  currentValue={d.initial_loan_amount ?? null}
                  display={formatCurrency(d.initial_loan_amount)}
                  placeholder="500000"
                />
              </DetailRow>
              <DetailRow fieldKey="cash_out_amount" label="Cash-Out Amount">
                <EditableLoanField
                  loanId={loanId}
                  field="cash_out_amount"
                  type="currency"
                  currentValue={d.cash_out_amount ?? null}
                  display={formatCurrency(d.cash_out_amount)}
                  placeholder="0"
                />
              </DetailRow>
              <DetailRow fieldKey="rate_type" label="Rate Type">
                <EditableLoanField
                  loanId={loanId}
                  field="rate_type"
                  type="enum"
                  options={RATE_TYPE_OPTIONS}
                  currentValue={d.rate_type ?? null}
                  display={d.rate_type ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="points" label="Points">
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
              <DetailRow fieldKey="rate_costs_points" label="Extension Costs - Points">
                <EditableLoanField
                  loanId={loanId}
                  field="rate_costs_points"
                  type="number"
                  currentValue={d.rate_costs_points ?? null}
                  display={d.rate_costs_points !== null && d.rate_costs_points !== undefined ? String(d.rate_costs_points) : '—'}
                  placeholder="0"
                  step="0.01"
                  inputWidthClass="w-24"
                />
              </DetailRow>
              <DetailRow fieldKey="other_exception_costs_points" label="Other/Exception Costs - Points">
                <EditableLoanField
                  loanId={loanId}
                  field="other_exception_costs_points"
                  type="number"
                  currentValue={d.other_exception_costs_points ?? null}
                  display={d.other_exception_costs_points !== null && d.other_exception_costs_points !== undefined ? String(d.other_exception_costs_points) : '—'}
                  placeholder="0"
                  step="0.01"
                  inputWidthClass="w-24"
                />
              </DetailRow>
              <DetailRow fieldKey="broker_points" label="Broker Points">
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
              <DetailRow fieldKey="broker_ysp" label="Broker YSP">
                <EditableLoanField
                  loanId={loanId}
                  field="broker_ysp"
                  type="number"
                  currentValue={d.broker_ysp ?? null}
                  display={d.broker_ysp !== null && d.broker_ysp !== undefined ? String(d.broker_ysp) : '—'}
                  placeholder="0"
                  step="0.01"
                  inputWidthClass="w-24"
                />
              </DetailRow>
              <DetailRow fieldKey="underwriting_fee" label="Underwriting Fee">
                <EditableLoanField
                  loanId={loanId}
                  field="underwriting_fee"
                  type="currency"
                  currentValue={d.underwriting_fee ?? null}
                  display={formatCurrency(d.underwriting_fee)}
                  placeholder="1695"
                />
              </DetailRow>
              <DetailRow fieldKey="legal_doc_prep_fee" label="Legal/Doc Prep Fee">
                <EditableLoanField
                  loanId={loanId}
                  field="legal_doc_prep_fee"
                  type="currency"
                  currentValue={d.legal_doc_prep_fee ?? null}
                  display={formatCurrency(d.legal_doc_prep_fee)}
                  placeholder="995"
                />
              </DetailRow>
              {/* Desk Review Fee + Small Balance Fee mirror Airtable
                  formula fields — the portal-side input is here for
                  display + reference; the Airtable sync pulls the
                  computed value in. Editing in the portal is allowed
                  (some workflows override the formula manually), but
                  the next sync will skip the push back per the schema
                  read-only guard. */}
              <DetailRow fieldKey="desk_review_fee" label="Desk Review Fee">
                <EditableLoanField
                  loanId={loanId}
                  field="desk_review_fee"
                  type="currency"
                  currentValue={d.desk_review_fee ?? null}
                  display={formatCurrency(d.desk_review_fee)}
                  placeholder="300"
                />
              </DetailRow>
              <DetailRow fieldKey="small_balance_fee" label="Small Balance Fee">
                <EditableLoanField
                  loanId={loanId}
                  field="small_balance_fee"
                  type="currency"
                  currentValue={d.small_balance_fee ?? null}
                  display={formatCurrency(d.small_balance_fee)}
                  placeholder="0"
                />
              </DetailRow>
              <DetailRow fieldKey="feasibility_fee" label="Feasibility Fee">
                <EditableLoanField
                  loanId={loanId}
                  field="feasibility_fee"
                  type="currency"
                  currentValue={d.feasibility_fee ?? null}
                  display={formatCurrency(d.feasibility_fee)}
                  placeholder="0"
                />
              </DetailRow>
              <DetailRow fieldKey="additional_fees" label="Additional Fees">
                <EditableLoanField
                  loanId={loanId}
                  field="additional_fees"
                  type="currency"
                  currentValue={d.additional_fees ?? null}
                  display={formatCurrency(d.additional_fees)}
                  placeholder="0"
                />
              </DetailRow>
              {/* Freeform notes so staff can describe what the
                  Additional Fees total covers — Flood Cert Fee, COGS
                  Fee, Credit Rescore Fee, "Other", etc. Portal-only;
                  Airtable doesn't track these individually. */}
              <DetailRow fieldKey="additional_fees_notes" label="Additional Fees — Notes">
                <EditableLoanField
                  loanId={loanId}
                  field="additional_fees_notes"
                  type="textarea"
                  currentValue={d.additional_fees_notes ?? null}
                  display={d.additional_fees_notes ?? '—'}
                  placeholder="e.g. Flood Cert Fee + COGS Fee"
                  inputWidthClass="w-72"
                />
              </DetailRow>
              <DetailRow fieldKey="prepayment_penalty" label="Prepayment Penalty">
                <EditableLoanField
                  loanId={loanId}
                  field="prepayment_penalty"
                  type="text"
                  currentValue={d.prepayment_penalty ?? null}
                  display={d.prepayment_penalty ?? '—'}
                  inputWidthClass="w-48"
                />
              </DetailRow>
              <DetailRow fieldKey="amortization_schedule" label="Amortization Schedule">
                <EditableLoanField
                  loanId={loanId}
                  field="amortization_schedule"
                  type="enum"
                  options={AMORTIZATION_OPTIONS}
                  currentValue={d.amortization_schedule ?? null}
                  display={d.amortization_schedule ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="first_payment_date" label="First Payment Date">
                <EditableLoanField
                  loanId={loanId}
                  field="first_payment_date"
                  type="date"
                  currentValue={d.first_payment_date ?? null}
                  display={formatDate(d.first_payment_date)}
                />
              </DetailRow>

              {/* Calculated, read-only — pulls from the Loan Summary fields.
                  Always renders if the section itself is visible; users
                  who don't want any Loan Terms info just hide every
                  field in the section, which leaves this calc line
                  alone but small. */}
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

            <Section title="Vendors (Title, Insurance, Appraiser)">
              <DetailRow fieldKey="title_company" label="Title Company / Agent">
                <EditableLoanField
                  loanId={loanId}
                  field="title_company"
                  type="text"
                  currentValue={d.title_company ?? null}
                  display={d.title_company ?? '—'}
                  inputWidthClass="w-56"
                />
              </DetailRow>
              <DetailRow fieldKey="title_email" label="Title Email">
                <EditableLoanField
                  loanId={loanId}
                  field="title_email"
                  type="text"
                  currentValue={d.title_email ?? null}
                  display={d.title_email ?? '—'}
                  inputWidthClass="w-56"
                />
              </DetailRow>
              <DetailRow fieldKey="title_phone" label="Title Phone">
                <EditableLoanField
                  loanId={loanId}
                  field="title_phone"
                  type="text"
                  currentValue={d.title_phone ?? null}
                  display={d.title_phone ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="insurance_company" label="Insurance Company / Agent">
                <EditableLoanField
                  loanId={loanId}
                  field="insurance_company"
                  type="text"
                  currentValue={d.insurance_company ?? null}
                  display={d.insurance_company ?? '—'}
                  inputWidthClass="w-56"
                />
              </DetailRow>
              <DetailRow fieldKey="insurance_email" label="Insurance Email">
                <EditableLoanField
                  loanId={loanId}
                  field="insurance_email"
                  type="text"
                  currentValue={d.insurance_email ?? null}
                  display={d.insurance_email ?? '—'}
                  inputWidthClass="w-56"
                />
              </DetailRow>
              <DetailRow fieldKey="insurance_phone" label="Insurance Phone">
                <EditableLoanField
                  loanId={loanId}
                  field="insurance_phone"
                  type="text"
                  currentValue={d.insurance_phone ?? null}
                  display={d.insurance_phone ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="appraisal_company" label="Appraiser / Appraisal Company">
                <EditableLoanField
                  loanId={loanId}
                  field="appraisal_company"
                  type="text"
                  currentValue={d.appraisal_company ?? null}
                  display={d.appraisal_company ?? '—'}
                  inputWidthClass="w-56"
                />
              </DetailRow>
              <DetailRow fieldKey="appraisal_email" label="Appraiser Email">
                <EditableLoanField
                  loanId={loanId}
                  field="appraisal_email"
                  type="text"
                  currentValue={d.appraisal_email ?? null}
                  display={d.appraisal_email ?? '—'}
                  inputWidthClass="w-56"
                />
              </DetailRow>
              <DetailRow fieldKey="appraisal_phone" label="Appraiser Phone">
                <EditableLoanField
                  loanId={loanId}
                  field="appraisal_phone"
                  type="text"
                  currentValue={d.appraisal_phone ?? null}
                  display={d.appraisal_phone ?? '—'}
                />
              </DetailRow>
            </Section>

            <Section title="Vesting Entity">
              <DetailRow fieldKey="vesting_in_entity" label="Vesting in Entity?">
                <EditableLoanField
                  loanId={loanId}
                  field="vesting_in_entity"
                  type="boolean"
                  currentValue={d.vesting_in_entity ?? false}
                />
              </DetailRow>
              <DetailRow fieldKey="entity_type" label="Entity Type">
                <EditableLoanField
                  loanId={loanId}
                  field="entity_type"
                  type="enum"
                  options={ENTITY_TYPE_OPTIONS}
                  currentValue={d.entity_type ?? null}
                  display={d.entity_type ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="entity_formation_state" label="Formation State">
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
              <DetailRow fieldKey="coborrower_name" label="Co-Borrower Name">
                <EditableLoanField
                  loanId={loanId}
                  field="coborrower_name"
                  type="text"
                  currentValue={d.coborrower_name ?? null}
                  display={d.coborrower_name ?? '—'}
                  inputWidthClass="w-48"
                />
              </DetailRow>
              <DetailRow fieldKey="coborrower_phone" label="Co-Borrower Phone">
                <EditableLoanField
                  loanId={loanId}
                  field="coborrower_phone"
                  type="text"
                  currentValue={d.coborrower_phone ?? null}
                  display={d.coborrower_phone ?? '—'}
                />
              </DetailRow>
              <DetailRow fieldKey="coborrower_email" label="Co-Borrower Email">
                <EditableLoanField
                  loanId={loanId}
                  field="coborrower_email"
                  type="text"
                  currentValue={d.coborrower_email ?? null}
                  display={d.coborrower_email ?? '—'}
                  inputWidthClass="w-56"
                />
              </DetailRow>
              <DetailRow fieldKey="experience_borrower" label="Borrower Experience">
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
              <DetailRow fieldKey="experience_coborrower" label="Co-Borrower Experience">
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
              <DetailRow fieldKey="number_of_properties" label="Number of Properties">
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
              <DetailRow fieldKey="verified_assets" label="Verified Assets">
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
              <DetailRow fieldKey="liquid_assets_total" label="Liquid Assets Total">
                <EditableLoanField
                  loanId={loanId}
                  field="liquid_assets_total"
                  type="currency"
                  currentValue={d.liquid_assets_total ?? null}
                  display={formatCurrency(d.liquid_assets_total)}
                  placeholder="250000"
                />
              </DetailRow>

              <Stacked fieldKey="experience_notes" label="Experience Notes">
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
              <DetailRow fieldKey="own_or_rent" label="Own or Rent (current home)">
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
              <DetailRow fieldKey="mortgage_on_primary" label="Mortgage on Primary Residence">
                <EditableLoanField
                  loanId={loanId}
                  field="mortgage_on_primary"
                  type="boolean"
                  currentValue={d.mortgage_on_primary ?? false}
                />
              </DetailRow>
              <DetailRow fieldKey="intent_to_occupy" label="Intent to Occupy Subject Property">
                <EditableLoanField
                  loanId={loanId}
                  field="intent_to_occupy"
                  type="boolean"
                  currentValue={d.intent_to_occupy ?? false}
                />
              </DetailRow>
              <DetailRow fieldKey="down_payment_borrowed" label="Down Payment Borrowed">
                <EditableLoanField
                  loanId={loanId}
                  field="down_payment_borrowed"
                  type="boolean"
                  currentValue={d.down_payment_borrowed ?? false}
                />
              </DetailRow>
            </Section>

            <Section title="Credit / Background">
              <DetailRow fieldKey="credit_score_estimate" label="Credit Score (Estimate)">
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
              <DetailRow fieldKey="credit_frozen" label="Credit Frozen">
                <EditableLoanField
                  loanId={loanId}
                  field="credit_frozen"
                  type="boolean"
                  currentValue={d.credit_frozen ?? false}
                />
              </DetailRow>
              <DetailRow fieldKey="credit_report_date" label="Credit Report Date">
                <EditableLoanField
                  loanId={loanId}
                  field="credit_report_date"
                  type="date"
                  currentValue={d.credit_report_date ?? null}
                  display={formatDate(d.credit_report_date)}
                />
              </DetailRow>
              <DetailRow fieldKey="credit_score" label="Credit Score (Pulled)">
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
              <DetailRow fieldKey="background_check_date" label="Background Check Date">
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

              <Stacked fieldKey="credit_background_notes" label="Credit / Background Notes">
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
              <DetailRow fieldKey="appraisal_order_date" label="Appraisal Order Date">
                <EditableLoanField
                  loanId={loanId}
                  field="appraisal_order_date"
                  type="date"
                  currentValue={d.appraisal_order_date ?? null}
                  display={formatDate(d.appraisal_order_date)}
                />
              </DetailRow>
              <DetailRow fieldKey="appraisal_paid_date" label="Appraisal Paid Date">
                <EditableLoanField
                  loanId={loanId}
                  field="appraisal_paid_date"
                  type="date"
                  currentValue={d.appraisal_paid_date ?? null}
                  display={formatDate(d.appraisal_paid_date)}
                />
              </DetailRow>
              <DetailRow fieldKey="appraisal_received_date" label="Appraisal Received Date">
                <EditableLoanField
                  loanId={loanId}
                  field="appraisal_received_date"
                  type="date"
                  currentValue={d.appraisal_received_date ?? null}
                  display={formatDate(d.appraisal_received_date)}
                />
              </DetailRow>
              <DetailRow fieldKey="appraisal_effective_date" label="Appraisal Effective Date">
                <EditableLoanField
                  loanId={loanId}
                  field="appraisal_effective_date"
                  type="date"
                  currentValue={d.appraisal_effective_date ?? null}
                  display={formatDate(d.appraisal_effective_date)}
                />
              </DetailRow>

              {/* 120-day validity countdown — calculated, read-only.
                  Anchored on the Effective Date (appraisal validity period
                  runs from when the appraiser estimated the value, not when
                  the doc landed in our inbox). */}
              <div className="flex justify-between items-center gap-3 pt-2 mt-1 border-t border-gray-100">
                <span className="text-gray-500 flex items-center gap-1.5">
                  Appraisal Days Left
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">calc</span>
                </span>
                <DaysLeftBadge value={daysLeft(d.appraisal_effective_date, 120)} />
              </div>
              {!d.appraisal_effective_date && (
                <p className="text-xs text-gray-400 italic">
                  Set Appraisal Effective Date above to start the 120-day countdown.
                </p>
              )}
            </Section>

            <Section title="Valuation / Collateral">
              <DetailRow fieldKey="purchase_price" label="Purchase Price">
                <EditableLoanField
                  loanId={loanId}
                  field="purchase_price"
                  type="currency"
                  currentValue={d.purchase_price ?? null}
                  display={formatCurrency(d.purchase_price)}
                  placeholder="450000"
                />
              </DetailRow>
              <DetailRow fieldKey="acquisition_date" label="Acquisition Date">
                <EditableLoanField
                  loanId={loanId}
                  field="acquisition_date"
                  type="date"
                  currentValue={d.acquisition_date ?? null}
                  display={formatDate(d.acquisition_date)}
                />
              </DetailRow>
              <DetailRow fieldKey="value_as_is" label="Value (As-Is)">
                <EditableLoanField
                  loanId={loanId}
                  field="value_as_is"
                  type="currency"
                  currentValue={d.value_as_is ?? null}
                  display={formatCurrency(d.value_as_is)}
                  placeholder="475000"
                />
              </DetailRow>
              <DetailRow fieldKey="arv" label="Value (ARV)">
                <EditableLoanField
                  loanId={loanId}
                  field="arv"
                  type="currency"
                  currentValue={loanArv ?? null}
                  display={formatCurrency(loanArv ?? null)}
                  placeholder="600000"
                />
              </DetailRow>
              <DetailRow fieldKey="value_bpo" label="Value (BPO)">
                <EditableLoanField
                  loanId={loanId}
                  field="value_bpo"
                  type="currency"
                  currentValue={d.value_bpo ?? null}
                  display={formatCurrency(d.value_bpo)}
                  placeholder="470000"
                />
              </DetailRow>
              <DetailRow fieldKey="payoff" label="Payoff">
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
              <DetailRow fieldKey="construction_holdback" label="Construction Holdback">
                <EditableLoanField
                  loanId={loanId}
                  field="construction_holdback"
                  type="currency"
                  currentValue={d.construction_holdback ?? null}
                  display={formatCurrency(d.construction_holdback)}
                  placeholder="50000"
                />
              </DetailRow>
              <DetailRow fieldKey="draw_fee" label="Draw Fee">
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
              <DetailRow fieldKey="qualifying_rent" label="Qualifying Rent (monthly)">
                <EditableLoanField
                  loanId={loanId}
                  field="qualifying_rent"
                  type="currency"
                  currentValue={d.qualifying_rent ?? null}
                  display={formatCurrency(d.qualifying_rent)}
                  placeholder="3500"
                />
              </DetailRow>
              <DetailRow fieldKey="annual_property_tax" label="Annual Property Tax">
                <EditableLoanField
                  loanId={loanId}
                  field="annual_property_tax"
                  type="currency"
                  currentValue={d.annual_property_tax ?? null}
                  display={formatCurrency(d.annual_property_tax)}
                  placeholder="6000"
                />
              </DetailRow>
              <DetailRow fieldKey="annual_insurance_premium" label="Annual Insurance Premium">
                <EditableLoanField
                  loanId={loanId}
                  field="annual_insurance_premium"
                  type="currency"
                  currentValue={d.annual_insurance_premium ?? null}
                  display={formatCurrency(d.annual_insurance_premium)}
                  placeholder="1800"
                />
              </DetailRow>
              <DetailRow fieldKey="annual_flood_insurance" label="Annual Flood Insurance">
                <EditableLoanField
                  loanId={loanId}
                  field="annual_flood_insurance"
                  type="currency"
                  currentValue={d.annual_flood_insurance ?? null}
                  display={formatCurrency(d.annual_flood_insurance)}
                  placeholder="0"
                />
              </DetailRow>
              <DetailRow fieldKey="annual_hoa_dues" label="Annual HOA Dues">
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

            {/* Declarations is a single composite — hiding the
                'declarations' key from the view hides the whole
                section because there's no per-row toggle to nuance
                it down (the rows are read-only application snapshots). */}
            <Section title="Declarations" sectionKey="declarations">
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
          </ViewCtx.Provider>
        </CardContent>
      )}

      <LoanDetailViewsManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        views={savedViews}
        onChanged={refreshViews}
        initialSelectedId={activeViewId}
      />
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

/** Collapsible sub-section inside the Loan Details card. Hides when the
 *  active view's hidden set contains `sectionKey` (e.g. 'declarations'
 *  for the composite Declarations section). */
function Section({
  title,
  sectionKey,
  defaultOpen = false,
  children,
}: {
  title: string
  sectionKey?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const { hidden } = useContext(ViewCtx)
  const [open, setOpen] = useState(defaultOpen)
  if (sectionKey && hidden.has(sectionKey)) return null
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
function DetailRow({
  fieldKey,
  label,
  children,
}: {
  fieldKey?: string
  label: string
  children: React.ReactNode
}) {
  const { hidden } = useContext(ViewCtx)
  if (fieldKey && hidden.has(fieldKey)) return null
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-gray-500">{label}</span>
      {children}
    </div>
  )
}

/** Stacked label / value, used for textareas that need width. */
function Stacked({
  fieldKey,
  label,
  children,
}: {
  fieldKey?: string
  label: string
  children: React.ReactNode
}) {
  const { hidden } = useContext(ViewCtx)
  if (fieldKey && hidden.has(fieldKey)) return null
  return (
    <div className="space-y-1">
      <span className="text-gray-500 block">{label}</span>
      {children}
    </div>
  )
}

// ============================================================
// View picker (header pill + dropdown)
// ============================================================

function ViewPicker({
  views,
  activeViewId,
  onSelect,
  onManage,
  open,
  setOpen,
}: {
  views: LoanDetailView[]
  activeViewId: string | null
  onSelect: (viewId: string | null) => void
  onManage: () => void
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  const active = views.find(v => v.id === activeViewId) ?? null
  const label = active ? active.name : 'All fields'

  return (
    <div ref={rootRef} className="relative inline-block shrink-0">
      <button
        type="button"
        // Click must NOT bubble to the outer card-collapse button.
        onClick={e => { e.stopPropagation(); setOpen(!open) }}
        className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 whitespace-nowrap"
      >
        <Filter className="w-3.5 h-3.5" />
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 w-60 bg-white border border-gray-200 rounded-md shadow-lg z-20"
          onClick={e => e.stopPropagation()}
        >
          <PickerItem
            label="All fields"
            checked={activeViewId === null}
            onClick={() => onSelect(null)}
          />
          {views.length > 0 && <div className="border-t border-gray-100" />}
          {views.map(v => (
            <PickerItem
              key={v.id}
              label={v.name}
              isDefault={v.is_default}
              checked={activeViewId === v.id}
              onClick={() => onSelect(v.id)}
            />
          ))}
          <div className="border-t border-gray-100" />
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onManage() }}
            className="block w-full px-3 py-2 text-xs text-left text-primary hover:bg-gray-50 font-medium"
          >
            Manage views…
          </button>
        </div>
      )}
    </div>
  )
}

function PickerItem({
  label,
  checked,
  isDefault,
  onClick,
}: {
  label: string
  checked: boolean
  isDefault?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className={`flex items-center justify-between gap-2 w-full px-3 py-2 text-sm text-left hover:bg-gray-50 ${
        checked ? 'bg-gray-50 font-medium text-gray-900' : 'text-gray-700'
      }`}
    >
      <span className="flex items-center gap-1.5 truncate">
        <span className="truncate">{label}</span>
        {isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />}
      </span>
      {checked && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
    </button>
  )
}
