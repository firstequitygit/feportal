// Centralized field + conditional-logic config for the loan application.
// One source of truth: render order, options, and visibility rules.

export type FieldType =
  | 'text' | 'email' | 'tel' | 'ssn' | 'date' | 'number' | 'currency'
  | 'select' | 'radio' | 'yesno' | 'textarea' | 'file'

export type ApplicationData = Record<string, unknown>

export interface FieldDef {
  /** Unique key within its section/repeat scope; also the data key. */
  name: string
  label: string
  type: FieldType
  required?: boolean
  options?: readonly string[]
  placeholder?: string
  help?: string
  /** Show only when this predicate is true. Absent = always visible. */
  visibleWhen?: (d: ApplicationData, scope?: ApplicationData) => boolean
  /** Required only when true (in addition to `required`). */
  requiredWhen?: (d: ApplicationData, scope?: ApplicationData) => boolean
  /** "Why we ask" tooltip text shown next to the field label. */
  helpTooltip?: string
}

// ---- Option lists (spec §5.1 — confirmed final) ----
export const CREDIT_SCORE_OPTIONS = ['> 780','760-779','740-759','720-739','700-719','680-699','660-679','640-659','620-639','600-619','< 599'] as const
export const LOAN_TYPE_OPTIONS = ['Fix & Flip/Renovation','New Construction','DSCR Rental Loan'] as const
export const PROPERTY_TYPE_OPTIONS = ['Single Family','Condo','Multifamily (2-4 Units)','Multifamily (5+ Units)','Mixed Use','Other Commercial'] as const
export const EXIT_STRATEGY_OPTIONS = ['Sell','Refinance','Other (Explain Below)'] as const
export const DEAL_SOURCE_OPTIONS = ['Short Sale','Bank Owned (REO)','Sheriff Sale','MLS','Foreclosure Auction','Wholesaler','Direct from Seller','Other'] as const
export const HEAR_ABOUT_OPTIONS = ['Internet Search (Google, Bing, etc.)','Social Media (Facebook, Instagram, etc.)','YouTube','Email Marketing','Text Message','Phone Call','Direct Mail','Networking Event','Realtor Referral','Broker Referral','Other Referral','3rd Party Website','3rd Party Publication','Other'] as const
export const LEASE_TYPE_OPTIONS = ['Annual','Month-to-Month','Short Term/Vacation Rental','Vacant'] as const
export const OTHER_RE_EXPERIENCE_OPTIONS = ['Realtor','Contractor','Wholesaler','Real Estate Attorney','Mortgage Broker/Lender'] as const
export const FLIPS_COMPLETED_OPTIONS = ['0','1 - 2','3 - 10','11+'] as const
export const MARITAL_STATUS_OPTIONS = ['Married','Single','Separated'] as const
export const PURCHASE_REFI_OPTIONS = ['Purchase','Refinance','Cash-Out Refinance'] as const
export const HOUSING_STATUS_OPTIONS = ['Own','Rent'] as const
export const ENTITY_TYPE_OPTIONS = ['LLC','Corporation','Limited Partnership','Other'] as const
export const HMDA_ETHNICITY_OPTIONS = ['Hispanic or Latino','Not Hispanic or Latino','I do not wish to provide this information'] as const
export const HMDA_RACE_OPTIONS = ['American Indian or Alaska Native','Asian','Black or African American','Native Hawaiian or Other Pacific Islander','White','Other','I do not wish to provide this information'] as const
export const HMDA_SEX_OPTIONS = ['Male','Female','I do not wish to provide this information'] as const

// Per-borrower field set (used for primary + each co-borrower; `scope` = that borrower's sub-object)
export const BORROWER_FIELDS: FieldDef[] = [
  { name: 'first_name', label: 'First Name', type: 'text', required: true },
  { name: 'middle_name', label: 'Middle Name', type: 'text' },
  { name: 'last_name', label: 'Last Name', type: 'text', required: true },
  {
    name: 'borrowing_as',
    label: 'Are you applying as an individual or through an LLC/entity?',
    type: 'radio',
    options: ['Individual', 'LLC / Entity'] as const,
    required: true,
    helpTooltip: "Most investment loans are made to an LLC. Choose 'LLC / Entity' if your purchase contract is in an LLC's name.",
  },
  { name: 'dob', label: 'Date of Birth', type: 'date', required: true,
    helpTooltip: "Verifies your identity and confirms you're of legal age to enter a loan agreement." },
  { name: 'ssn', label: 'Social Security Number', type: 'ssn', required: true,
    helpTooltip: "We use your SSN only to verify your identity. No credit check happens until you authorize it on Step 4." },
  { name: 'us_citizen', label: 'U.S. Citizen?', type: 'yesno', required: true },
  { name: 'permanent_resident_alien', label: 'Permanent Resident Alien?', type: 'yesno', required: true },
  { name: 'foreign_national', label: 'Foreign National?', type: 'yesno', required: true },
  { name: 'legal_status', label: 'What is your current legal status?', type: 'text' },
  { name: 'marital_status', label: 'Marital Status', type: 'select', options: MARITAL_STATUS_OPTIONS,
    helpTooltip: "Required because your spouse may have rights in the property under your state's marital property laws." },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'cell_phone', label: 'Cell Phone', type: 'tel', required: true },
  { name: 'other_phone', label: 'Other Phone', type: 'tel' },
  { name: 'credit_score', label: 'Estimated Credit Score', type: 'select', options: CREDIT_SCORE_OPTIONS, required: true,
    helpTooltip: "Helps us route your file to the right loan product. We'll pull credit ourselves during underwriting." },
  { name: 'address_street', label: 'Address Line 1', type: 'text', required: true },
  { name: 'address_city', label: 'City', type: 'text', required: true },
  { name: 'address_state', label: 'State', type: 'text', required: true },
  { name: 'address_zip', label: 'Zip Code', type: 'text', required: true },
  { name: 'lived_2y', label: 'Have you lived here for two years?', type: 'yesno', required: true },
  { name: 'prior_address_street', label: 'Prior Address Line 1', type: 'text',
    visibleWhen: (_d, s) => s?.lived_2y === false, requiredWhen: (_d, s) => s?.lived_2y === false },
  { name: 'prior_address_city', label: 'Prior City', type: 'text',
    visibleWhen: (_d, s) => s?.lived_2y === false },
  { name: 'prior_address_state', label: 'Prior State', type: 'text',
    visibleWhen: (_d, s) => s?.lived_2y === false },
  { name: 'prior_address_zip', label: 'Prior Zip', type: 'text',
    visibleWhen: (_d, s) => s?.lived_2y === false },
]

// Per-borrower experience fields (Step 3)
export const EXPERIENCE_FIELDS: FieldDef[] = [
  { name: 'flips_last_3y', label: 'Fix & Flips / Fix & Holds Completed Last 3 Years', type: 'select', options: FLIPS_COMPLETED_OPTIONS },
  { name: 'rental_units_owned', label: 'Number of Rental Units Currently Owned', type: 'number' },
  { name: 'other_re_experience', label: 'Other Real Estate Experience', type: 'select', options: OTHER_RE_EXPERIENCE_OPTIONS },
  { name: 'experience_explanation', label: 'Experience Explanation', type: 'textarea' },
]

// Per-borrower declarations (Step 4) — all yes/no
export const DECLARATION_FIELDS: FieldDef[] = [
  { name: 'd_liens', label: 'Do you have any outstanding liens or judgements against you?', type: 'yesno', required: true },
  { name: 'd_bankruptcy', label: 'Have you declared bankruptcy or had a foreclosure in the past 4 years?', type: 'yesno', required: true },
  { name: 'd_delinquent', label: 'Are you presently delinquent on any debt, lien, mortgage or financial obligation?', type: 'yesno', required: true },
  { name: 'd_foreclosure_obligation', label: 'Have you directly or indirectly been obligated on any loan which resulted in foreclosure, transfer of title in lieu of foreclosure, or judgement?', type: 'yesno', required: true },
  { name: 'd_lawsuit', label: 'Are you a party to a lawsuit?', type: 'yesno', required: true },
  { name: 'd_down_payment_borrowed', label: 'Is any part of the down payment borrowed?', type: 'yesno', required: true },
  { name: 'd_us_citizen', label: 'Are you a US Citizen?', type: 'yesno', required: true },
  { name: 'd_permanent_resident', label: 'Are you a permanent resident alien?', type: 'yesno', required: true },
  { name: 'd_foreign_national', label: 'Are you a foreign national?', type: 'yesno', required: true },
  { name: 'd_intent_to_occupy', label: 'Do you intend to occupy the subject property?', type: 'yesno', required: true },
]

// Per-borrower HMDA (Step 4)
export const HMDA_FIELDS: FieldDef[] = [
  { name: 'hmda_ethnicity', label: 'Ethnicity', type: 'radio', options: HMDA_ETHNICITY_OPTIONS, required: true },
  { name: 'hmda_race', label: 'Race', type: 'radio', options: HMDA_RACE_OPTIONS, required: true },
  { name: 'hmda_sex', label: 'Sex', type: 'radio', options: HMDA_SEX_OPTIONS, required: true },
]

// Deal section (Step 2). `d` is the whole form. Conditional rules per spec §4.1.
export const isBridge = (d: ApplicationData) => d.loan_type === 'Fix & Flip/Renovation' || d.loan_type === 'New Construction'
export const isDSCR = (d: ApplicationData) => d.loan_type === 'DSCR Rental Loan'
export const isRefi = (d: ApplicationData) => d.purchase_or_refi === 'Refinance' || d.purchase_or_refi === 'Cash-Out Refinance'
export const isPurchase = (d: ApplicationData) => d.purchase_or_refi === 'Purchase'

export const DEAL_FIELDS: FieldDef[] = [
  { name: 'has_deal', label: 'Do you have a deal?', type: 'yesno', required: true },
  { name: 'purchase_or_refi', label: 'Purchase or Refi', type: 'select', options: PURCHASE_REFI_OPTIONS, required: true },
  { name: 'loan_type', label: 'Loan Type', type: 'select', options: LOAN_TYPE_OPTIONS, required: true },
  { name: 'property_type', label: 'Property Type', type: 'select', options: PROPERTY_TYPE_OPTIONS, required: true },
  { name: 'property_street', label: 'Property Address Line 1', type: 'text', required: true },
  { name: 'property_city', label: 'City', type: 'text', required: true },
  { name: 'property_state', label: 'State', type: 'text', required: true },
  { name: 'property_zip', label: 'Zip Code', type: 'text', required: true },
  { name: 'deal_source', label: 'Deal Source', type: 'select', options: DEAL_SOURCE_OPTIONS },
  { name: 'date_purchased', label: 'Date Purchased', type: 'date', visibleWhen: isPurchase },
  { name: 'original_purchase_price', label: 'Original Purchase Price', type: 'currency' },
  { name: 'renovations_completed', label: 'Renovations Completed', type: 'currency' },
  { name: 'current_value', label: 'Current Value', type: 'currency', required: true },
  { name: 'current_debt', label: 'Is There Current Debt on the Property?', type: 'yesno', visibleWhen: isRefi },
  { name: 'debt_current_24mo', label: 'Has Debt Been Current Past 24 Months?', type: 'yesno', visibleWhen: (d) => isRefi(d) && d.current_debt === true },
  { name: 'current_loan_balance', label: 'Current Loan Balance', type: 'currency', visibleWhen: isRefi },
  { name: 'purchase_price', label: 'Purchase Price', type: 'currency', required: true, visibleWhen: isPurchase },
  { name: 'construction_costs', label: 'Construction Costs', type: 'currency', visibleWhen: isBridge, requiredWhen: isBridge },
  { name: 'after_repaired_value', label: 'After Repaired Value', type: 'currency', visibleWhen: isBridge, requiredWhen: isBridge },
  { name: 'exit_strategy', label: 'Exit Strategy', type: 'select', options: EXIT_STRATEGY_OPTIONS, visibleWhen: isBridge },
  { name: 'exit_strategy_other', label: 'Exit Strategy — Explain', type: 'textarea', visibleWhen: (d) => isBridge(d) && d.exit_strategy === 'Other (Explain Below)' },
  { name: 'requested_loan_amount', label: 'Requested Loan Amount', type: 'currency' },
  { name: 'cash_for_down_payment', label: 'Cash For Down Payment', type: 'currency', help: 'How much cash do the borrowers have available for a downpayment?' },
  { name: 'reserves_post_closing', label: 'Reserves Post Closing', type: 'currency', help: 'How much cash will borrowers have post closing? Include checking, savings, 401k, IRA etc.' },
  { name: 'number_of_units', label: 'Number of Units', type: 'number', visibleWhen: (d) => isDSCR(d) || d.property_type === 'Multifamily (2-4 Units)' || d.property_type === 'Multifamily (5+ Units)' },
  { name: 'total_monthly_rents', label: 'Total Monthly Rents (All Units)', type: 'currency', visibleWhen: isDSCR },
  { name: 'rent_roll', label: 'Property Rent Roll/P&L', type: 'file', visibleWhen: isDSCR },
  { name: 'annual_property_taxes', label: 'Annual Property Taxes', type: 'currency' },
  { name: 'annual_property_insurance', label: 'Annual Property Insurance', type: 'currency' },
  { name: 'monthly_flood_insurance', label: 'Monthly Flood Insurance', type: 'currency' },
  { name: 'monthly_hoa_dues', label: 'Monthly HOA Dues', type: 'currency' },
  { name: 'has_broker', label: 'Do you have an outside mortgage broker?', type: 'yesno' },
  { name: 'broker_name', label: "Broker's Name", type: 'text', visibleWhen: (d) => d.has_broker === true },
  { name: 'broker_email', label: "Broker's Email", type: 'email', visibleWhen: (d) => d.has_broker === true },
  { name: 'broker_phone', label: "Broker's Phone", type: 'tel', visibleWhen: (d) => d.has_broker === true },
  { name: 'broker_fee', label: 'Broker Fee', type: 'text', visibleWhen: (d) => d.has_broker === true },
  { name: 'has_title_vendor', label: 'Do you have a preferred vendor for title insurance?', type: 'yesno' },
  { name: 'title_company', label: 'Title Company Name', type: 'text', visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'title_contact_name', label: 'Title Contact Name', type: 'text', visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'title_contact_email', label: 'Title Contact Email', type: 'email', visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'title_contact_phone', label: 'Title Contact Phone', type: 'tel', visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'has_insurance_vendor', label: 'Do you have a preferred vendor for property insurance?', type: 'yesno' },
  { name: 'insurance_company', label: 'Insurance Company Name', type: 'text', visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'insurance_contact_name', label: 'Insurance Contact Name', type: 'text', visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'insurance_contact_email', label: 'Insurance Contact Email', type: 'email', visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'insurance_contact_phone', label: 'Insurance Contact Phone', type: 'tel', visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'other_details', label: 'Other Details', type: 'textarea' },
]

// Step 1 primary-only fields (in addition to BORROWER_FIELDS for the primary)
export const PRIMARY_EXTRA_FIELDS: FieldDef[] = [
  { name: 'housing_status', label: 'Housing Status', type: 'select', options: HOUSING_STATUS_OPTIONS },
  { name: 'mortgage_on_primary', label: 'Is there a mortgage on your primary?', type: 'yesno' },
  { name: 'entity_name', label: 'Entity Name', type: 'text',
    visibleWhen: (_d, s) => s?.borrowing_as === 'LLC / Entity',
    requiredWhen: (_d, s) => s?.borrowing_as === 'LLC / Entity' },
  { name: 'entity_type', label: 'Entity Type', type: 'select', options: ENTITY_TYPE_OPTIONS,
    visibleWhen: (_d, s) => s?.borrowing_as === 'LLC / Entity',
    requiredWhen: (_d, s) => s?.borrowing_as === 'LLC / Entity' },
  { name: 'hear_about_us', label: 'How did you hear about us?', type: 'select', options: HEAR_ABOUT_OPTIONS, required: true },
  { name: 'hear_about_details', label: 'Details', type: 'text' },
]

export interface UnitData { currently_rented?: boolean; current_rent?: number; market_rent?: number; lease_type?: string }
export const UNIT_FIELDS: FieldDef[] = [
  { name: 'currently_rented', label: 'Currently Rented', type: 'yesno' },
  { name: 'current_rent', label: 'Current Rent', type: 'currency' },
  { name: 'market_rent', label: 'Market Rent', type: 'currency' },
  { name: 'lease_type', label: 'Lease Type', type: 'select', options: LEASE_TYPE_OPTIONS },
]

/** Generic visibility resolver used by the renderer AND server validation. */
export function isVisible(f: FieldDef, data: ApplicationData, scope?: ApplicationData): boolean {
  return f.visibleWhen ? f.visibleWhen(data, scope) : true
}
export function isRequired(f: FieldDef, data: ApplicationData, scope?: ApplicationData): boolean {
  if (!isVisible(f, data, scope)) return false
  if (f.requiredWhen && f.requiredWhen(data, scope)) return true
  return !!f.required
}

export interface StepDef {
  id: string
  title: string
  estimateMinutes: number
}

export const STEPS: StepDef[] = [
  { id: 'borrower',    title: 'Borrower Info',            estimateMinutes: 5 },
  { id: 'deal',        title: 'Deal Info',                estimateMinutes: 4 },
  { id: 'experience',  title: 'Experience',               estimateMinutes: 2 },
  { id: 'disclosures', title: 'Disclosures & Signatures', estimateMinutes: 4 },
  { id: 'payment',     title: 'Payment',                  estimateMinutes: 1 },
]

export const TOTAL_STEPS = STEPS.length
export const STEP_TITLES = STEPS.map(s => s.title) as string[]
export const MAX_CO_BORROWERS = 3 // 4 borrowers total
