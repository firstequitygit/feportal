import { APPLICATION_LOAN_TYPE_MAP, type LoanType } from './types'
import type { ApplicationData } from './application-fields'

export interface MappedBorrower {
  full_name: string
  email: string | null
  phone: string | null
  entity_name: string | null
  current_address_street: string | null
  current_address_city: string | null
  current_address_state: string | null
  current_address_zip: string | null
  at_current_address_2y: boolean | null
  prior_address_street: string | null
  prior_address_city: string | null
  prior_address_state: string | null
  prior_address_zip: string | null
}

export interface MappedApplication {
  borrowers: MappedBorrower[]            // [0] = primary
  loan: {
    property_address: string | null
    loan_type: LoanType | null
    loan_amount: number | null
    entity_name: string | null
    pipeline_stage: 'New Application'
  }
  loanDetails: Record<string, unknown>   // keyed to loan_details columns
  loanDemographics: { ethnicity: string | null; race: string | null; sex: string | null }
  meta: { loanOfficerName: string | null; primaryEmail: string | null; primaryFirstName: string | null; propertyAddress: string }
}

const s = (v: unknown): string | null => {
  if (typeof v === 'string') { const t = v.trim(); return t || null }
  if (typeof v === 'number') return String(v)
  return null
}
const n = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const c = v.replace(/[$,\s]/g, ''); const x = Number(c); return c && !isNaN(x) ? x : null }
  return null
}
const b = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null)

function borrowerFrom(o: Record<string, unknown>): MappedBorrower {
  const name = [s(o.first_name), s(o.middle_name), s(o.last_name)].filter(Boolean).join(' ')
  return {
    full_name: name || 'Unknown Applicant',
    email: s(o.email),
    phone: s(o.cell_phone) ?? s(o.other_phone),
    entity_name: null,
    current_address_street: s(o.address_street),
    current_address_city: s(o.address_city),
    current_address_state: s(o.address_state),
    current_address_zip: s(o.address_zip),
    at_current_address_2y: b(o.lived_2y),
    prior_address_street: s(o.prior_address_street),
    prior_address_city: s(o.prior_address_city),
    prior_address_state: s(o.prior_address_state),
    prior_address_zip: s(o.prior_address_zip),
  }
}

/** Pure transform: a draft `loan_applications.data` blob → the canonical portal rows (borrowers/loan/loan_details/loan_demographics). No DB/IO. */
export function mapApplication(data: ApplicationData): MappedApplication {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const entityName = s(primary.entity_name)
  const borrowers = [borrowerFrom(primary), ...cobs.map(borrowerFrom)]
  if (borrowers[0]) borrowers[0].entity_name = entityName

  const propStreet = s(data.property_street)
  const propAddress = [propStreet, s(data.property_city), s(data.property_state), s(data.property_zip)].filter(Boolean).join(', ')
  const loanTypeLabel = s(data.loan_type)
  const loanType = loanTypeLabel ? (APPLICATION_LOAN_TYPE_MAP[loanTypeLabel] ?? null) : null

  const decl = {
    outstanding_judgements: b(primary.d_liens),
    bankruptcy_or_foreclosure: b(primary.d_bankruptcy),
    delinquent_debt: b(primary.d_delinquent),
    foreclosure_obligation: b(primary.d_foreclosure_obligation),
    party_to_lawsuit: b(primary.d_lawsuit),
    down_payment_borrowed: b(primary.d_down_payment_borrowed),
    us_citizen: b(primary.d_us_citizen),
    permanent_resident: b(primary.d_permanent_resident),
    intent_to_occupy: b(primary.d_intent_to_occupy),
    explanation: s(data.declarations_explanation),
    per_borrower: borrowers.map((_, i) => {
      const src = i === 0 ? primary : cobs[i - 1]
      return {
        d_liens: b(src.d_liens), d_bankruptcy: b(src.d_bankruptcy), d_delinquent: b(src.d_delinquent),
        d_foreclosure_obligation: b(src.d_foreclosure_obligation), d_lawsuit: b(src.d_lawsuit),
        d_down_payment_borrowed: b(src.d_down_payment_borrowed), d_us_citizen: b(src.d_us_citizen),
        d_permanent_resident: b(src.d_permanent_resident),
        d_intent_to_occupy: b(src.d_intent_to_occupy),
        hmda_ethnicity: s(src.hmda_ethnicity), hmda_race: s(src.hmda_race), hmda_sex: s(src.hmda_sex),
      }
    }),
  }

  const loanDetails: Record<string, unknown> = {
    submitted_at: new Date().toISOString().slice(0, 10),
    property_street: propStreet,
    property_city: s(data.property_city),
    property_state: s(data.property_state),
    property_zip: s(data.property_zip),
    property_type: s(data.property_type),
    number_of_units: n(data.number_of_units),
    loan_type_one: s(data.purchase_or_refi),
    initial_loan_amount: n(data.requested_loan_amount),
    coborrower_name: cobs.length ? borrowers.slice(1).map(x => x.full_name).join('; ') : null,
    experience_borrower: s(primary.flips_last_3y),
    number_of_properties: n(primary.rental_units_owned),
    experience_notes: [
      s(primary.other_re_experience) && `Other RE experience: ${s(primary.other_re_experience)}`,
      s(primary.experience_explanation),
    ].filter(Boolean).join('\n') || null,
    credit_score_estimate: null,
    own_or_rent: s(primary.housing_status),
    mortgage_on_primary: b(primary.mortgage_on_primary),
    title_company: s(data.title_company),
    title_email: s(data.title_contact_email),
    title_phone: s(data.title_contact_phone),
    insurance_company: s(data.insurance_company),
    insurance_email: s(data.insurance_contact_email),
    insurance_phone: s(data.insurance_contact_phone),
    entity_type: s(primary.entity_type),
    down_payment_borrowed: b(primary.d_down_payment_borrowed),
    intent_to_occupy: b(primary.d_intent_to_occupy),
    declarations: decl,
    purchase_price: n(data.purchase_price) ?? n(data.original_purchase_price),
    acquisition_date: s(data.date_purchased),
    value_as_is: n(data.current_value),
    payoff: n(data.current_loan_balance),
    qualifying_rent: n(data.total_monthly_rents),
    annual_property_tax: n(data.annual_property_taxes),
    annual_insurance_premium: n(data.annual_property_insurance),
    // Form collects a MONTHLY HOA figure; the column (and downstream DSCR math) expect annual.
    annual_hoa_dues: (() => { const m = n(data.monthly_hoa_dues); return m === null ? null : m * 12 })(),
  }

  return {
    borrowers,
    loan: {
      property_address: propAddress || null,
      loan_type: loanType,
      loan_amount: n(data.requested_loan_amount),
      entity_name: entityName,
      pipeline_stage: 'New Application',
    },
    loanDetails,
    loanDemographics: {
      ethnicity: s(primary.hmda_ethnicity),
      race: s(primary.hmda_race),
      sex: s(primary.hmda_sex),
    },
    meta: {
      loanOfficerName: null,
      primaryEmail: s(primary.email),
      primaryFirstName: s(primary.first_name),
      propertyAddress: propAddress || 'your property',
    },
  }
}
