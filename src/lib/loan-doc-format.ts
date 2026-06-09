// Shared formatters + derived calculations used by every loan-doc
// generator (Committee Review Sheet, Term Sheet, Attorney Submission).
// Mirrors the field intent on the original Airtable templates the UW
// is migrating away from.

import { formatDate } from './format-date'

// ---- Currency / number formatters ----

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const currencyCentsFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function fmtCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '$0'
  return currencyFmt.format(val)
}

export function fmtCurrencyCents(val: number | null | undefined): string {
  if (val === null || val === undefined) return '$0.00'
  return currencyCentsFmt.format(val)
}

/** Portal stores percent as the rate (7.75 = 7.75%), occasionally
 *  as a fraction (0.0775 = 7.75%). Format both safely. */
export function fmtRatePct(val: number | null | undefined): string {
  if (val === null || val === undefined) return '0.000%'
  const pct = val < 1 ? val * 100 : val
  return `${pct.toFixed(3)}%`
}

/** Fraction → percentage with 2 decimals (e.g. 0.6543 → "65.43%"). */
export function fmtRatio(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return '—'
  return percentFmt.format(val)
}

/** Date formatted as M/D/YYYY for the doc letterhead. */
export function fmtLetterDate(d: Date = new Date()): string {
  const m = d.getMonth() + 1
  const day = d.getDate()
  const y = d.getFullYear()
  return `${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}/${y}`
}

/** Expiration = 30 days from today (Term Sheet boilerplate). */
export function fmtExpirationDate(d: Date = new Date()): string {
  const exp = new Date(d)
  exp.setDate(exp.getDate() + 30)
  return formatDate(`${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`)
}

// ---- Derived fee calculations ----
//
// Origination Fee, Broker Fee, and similar percentage-of-loan
// figures are stored as basis points in the portal (Points,
// Broker Points, etc.). Multiply by loan amount and divide by 100
// to get the dollar amount.

export function calcOriginationFee(
  loanAmount: number | null | undefined,
  points: number | null | undefined,
): number | null {
  if (!loanAmount || !points) return null
  return (loanAmount * points) / 100
}

export function calcBrokerFee(
  loanAmount: number | null | undefined,
  brokerPoints: number | null | undefined,
): number | null {
  if (!loanAmount || !brokerPoints) return null
  return (loanAmount * brokerPoints) / 100
}

// ---- Monthly payment ----
//
// Two interest-only checks because the portal historically stored
// the flag in two different places.

export function calcMonthlyPayment(
  amount: number | null | undefined,
  ratePct: number | null | undefined,
  termMonths: number | null | undefined,
  interestOnly: string | null | undefined,
  amortizationSchedule: string | null | undefined,
): number | null {
  if (!amount || !ratePct) return null
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

// ---- DSCR ----

export function calcDSCR(
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

// ---- Loan-program / term labels ----

/** Map portal loan_type to the Loan Program label used in the
 *  Term Sheet appendix and Attorney Submission Summary. */
export function loanProgramLabel(
  loanType: string | null | undefined,
  termMonths: number | null | undefined,
): string {
  if (loanType === 'Rental (DSCR)') {
    if (termMonths === 360) return '30-Year Rental Loan'
    if (termMonths === 240) return '20-Year Rental Loan'
    if (termMonths) return `${Math.round(termMonths / 12)}-Year Rental Loan`
    return 'Rental Loan'
  }
  if (loanType === 'Fix & Flip (Bridge)') return 'Fix & Flip Bridge Loan'
  if (loanType === 'New Construction') return 'New Construction Loan'
  return loanType ?? '—'
}

/** "30 Years" / "12 Months" — friendly term label. */
export function termLabel(termMonths: number | null | undefined): string {
  if (!termMonths) return '—'
  if (termMonths % 12 === 0) {
    const years = termMonths / 12
    return `${years} Year${years === 1 ? '' : 's'}`
  }
  return `${termMonths} Months`
}

// ---- People helpers ----

/** Borrower's last word from full_name → "Last Name". */
export function lastNameOf(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** Joined Guarantors string: "Primary Borrower, Co-Borrower 2, ..." */
export function joinGuarantors(
  primary: string | null | undefined,
  co1?: string | null,
  co2?: string | null,
  co3?: string | null,
): string {
  const list = [primary, co1, co2, co3].filter((x): x is string => !!x && x.trim().length > 0)
  return list.join(', ')
}

/** Composes a property address line for the Term Sheet "Collateral" row. */
export function composePropertyAddress(
  street: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
  fallback?: string | null,
): string {
  const parts = [street, city, [state, zip].filter(Boolean).join(' ')].filter((p): p is string => !!p && p.trim().length > 0)
  if (parts.length > 0) return parts.join(', ')
  return fallback ?? '—'
}
