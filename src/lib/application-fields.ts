// Centralized field + conditional-logic config for the loan application.
// One source of truth: render order, options, and visibility rules.

export type FieldType =
  | 'text' | 'email' | 'tel' | 'ssn' | 'date' | 'number' | 'currency'
  | 'select' | 'radio' | 'yesno' | 'textarea' | 'file' | 'signature'

export type ApplicationData = Record<string, unknown>

export interface FieldDef {
  /** Unique key within its section/repeat scope; also the data key. */
  name: string
  label: string
  type: FieldType
  required?: boolean
  options?: readonly string[]
  /** Dynamic options resolver - takes precedence over `options` when present. */
  optionsWhen?: (d: ApplicationData, scope?: ApplicationData) => readonly string[]
  placeholder?: string
  help?: string
  /** Show only when this predicate is true. Absent = always visible. */
  visibleWhen?: (d: ApplicationData, scope?: ApplicationData) => boolean
  /** Required only when true (in addition to `required`). */
  requiredWhen?: (d: ApplicationData, scope?: ApplicationData) => boolean
  /** "Why we ask" tooltip text shown next to the field label. */
  helpTooltip?: string
  /** Groups consecutive fields under a labeled section heading in the renderer. */
  section?: string
}

// ---- Option lists (spec 5.1, confirmed final) ----
export const CREDIT_SCORE_OPTIONS = ['> 780','760-779','740-759','720-739','700-719','680-699','660-679','640-659','620-639','600-619','< 599'] as const
export const LOAN_TYPE_OPTIONS = ['Fix & Flip/Renovation','New Construction','DSCR Rental Loan'] as const
export const PROPERTY_TYPE_OPTIONS = ['Single Family','Condo','Multifamily (2-4 Units)','Multifamily (5+ Units)','Mixed Use','Other Commercial'] as const
export const PROPERTY_TYPE_OPTIONS_BRIDGE = [
  'Single Family', 'Condo',
  'Multifamily (2-4 Units)', 'Multifamily (5+ Units)',
  'Mixed Use', 'Other Commercial',
] as const
export const PROPERTY_TYPE_OPTIONS_DSCR = [
  'Single Family', 'Condo',
  'Multifamily (2 Units)', 'Multifamily (3 Units)', 'Multifamily (4 Units)', 'Multifamily (5+ Units)',
  'Mixed Use',
] as const
export const EXIT_STRATEGY_OPTIONS = ['Sell','Refinance','Other (Explain Below)'] as const
export const DEAL_SOURCE_OPTIONS = ['Short Sale','Bank Owned (REO)','Sheriff Sale','MLS','Foreclosure Auction','Wholesaler','Direct from Seller','Other'] as const
export const HEAR_ABOUT_OPTIONS = ['Internet Search (Google, Bing, etc.)','Social Media (Facebook, Instagram, etc.)','YouTube','Email Marketing','Text Message','Phone Call','Direct Mail','Networking Event','Realtor Referral','Broker Referral','Other Referral','3rd Party Website','3rd Party Publication','Other'] as const
export const OTHER_RE_EXPERIENCE_OPTIONS = ['Realtor','Contractor','Wholesaler','Real Estate Attorney','Mortgage Broker/Lender'] as const
export const FLIPS_COMPLETED_OPTIONS = ['0','1 - 2','3 - 10','11+'] as const
export const MARITAL_STATUS_OPTIONS = ['Married','Single','Separated'] as const
export const PURCHASE_REFI_OPTIONS = ['Purchase','Refinance','Cash-Out Refinance'] as const
export const HOUSING_STATUS_OPTIONS = ['Own','Rent'] as const
export const ENTITY_TYPE_OPTIONS = ['LLC','Corporation','Limited Partnership','Other'] as const
export const LOAN_OFFICER_OPTIONS = ['Christian Pepe','Anthony Palmiotto','Cory J Anderson','Ryan Commesso','Bill McGrorry','Vincent Gruosso','Adam Scovill','Garry Merritt','Christopher Marcigliano','Other'] as const
export const HMDA_ETHNICITY_OPTIONS = ['Hispanic or Latino','Not Hispanic or Latino','I do not wish to provide this information'] as const
export const HMDA_RACE_OPTIONS = ['American Indian or Alaska Native','Asian','Black or African American','Native Hawaiian or Other Pacific Islander','White','Other','I do not wish to provide this information'] as const
export const HMDA_SEX_OPTIONS = ['Male','Female','I do not wish to provide this information'] as const

// Per-borrower field set (used for primary + each co-borrower; `scope` = that borrower's sub-object)
export const BORROWER_FIELDS: FieldDef[] = [
  { name: 'first_name', label: 'First Name', type: 'text', required: true, placeholder: 'John', section: 'About you' },
  { name: 'middle_name', label: 'Middle Name', type: 'text', placeholder: 'Quentin', section: 'About you' },
  { name: 'last_name', label: 'Last Name', type: 'text', required: true, placeholder: 'Smith', section: 'About you' },
  { name: 'dob', label: 'Date of Birth', type: 'date', required: true, section: 'About you',
    helpTooltip: "Verifies your identity and confirms you're of legal age to enter a loan agreement." },
  { name: 'ssn', label: 'Social Security Number', type: 'ssn', required: true, section: 'About you',
    helpTooltip: "We use your SSN only to verify your identity. No credit check happens until you authorize it on Step 4." },
  { name: 'us_citizen', label: 'U.S. Citizen?', type: 'yesno', required: true, section: 'Citizenship & marital status' },
  { name: 'permanent_resident_alien', label: 'Permanent Resident Alien? (Green Card holder)', type: 'yesno',
    visibleWhen: (_d, s) => s?.us_citizen === false, requiredWhen: (_d, s) => s?.us_citizen === false,
    section: 'Citizenship & marital status' },
  { name: 'legal_status', label: 'What is your current legal status?', type: 'text',
    visibleWhen: (_d, s) => s?.us_citizen === false && s?.permanent_resident_alien === false,
    requiredWhen: (_d, s) => s?.us_citizen === false && s?.permanent_resident_alien === false,
    section: 'Citizenship & marital status' },
  { name: 'marital_status', label: 'Marital Status', type: 'select', options: MARITAL_STATUS_OPTIONS,
    section: 'Citizenship & marital status',
    helpTooltip: "Required because your spouse may have rights in the property under your state's marital property laws." },
  { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@example.com', section: 'Contact information' },
  { name: 'cell_phone', label: 'Cell Phone', type: 'tel', required: true, placeholder: '(732) 555-0100', section: 'Contact information' },
  { name: 'other_phone', label: 'Other Phone', type: 'tel', placeholder: '(732) 555-0100', section: 'Contact information' },
  { name: 'credit_score', label: 'Estimated Credit Score', type: 'select', options: CREDIT_SCORE_OPTIONS, required: true,
    section: 'Credit',
    helpTooltip: "Helps us route your file to the right loan product. We'll pull credit ourselves during underwriting." },
  { name: 'address_street', label: 'Address Line 1', type: 'text', required: true, placeholder: '123 Main St', section: 'Current address' },
  { name: 'address_city', label: 'City', type: 'text', required: true, placeholder: 'Sea Girt', section: 'Current address' },
  { name: 'address_state', label: 'State', type: 'text', required: true, placeholder: 'NJ', section: 'Current address' },
  { name: 'address_zip', label: 'Zip Code', type: 'text', required: true, placeholder: '08750', section: 'Current address' },
  { name: 'lived_2y', label: 'Have you lived here for two years?', type: 'yesno', required: true, section: 'Current address' },
  { name: 'prior_address_street', label: 'Prior Address Line 1', type: 'text', placeholder: '456 Oak Ave',
    visibleWhen: (_d, s) => s?.lived_2y === false, requiredWhen: (_d, s) => s?.lived_2y === false,
    section: 'Current address' },
  { name: 'prior_address_city', label: 'Prior City', type: 'text', placeholder: 'Asbury Park',
    visibleWhen: (_d, s) => s?.lived_2y === false, requiredWhen: (_d, s) => s?.lived_2y === false,
    section: 'Current address' },
  { name: 'prior_address_state', label: 'Prior State', type: 'text', placeholder: 'NJ',
    visibleWhen: (_d, s) => s?.lived_2y === false, requiredWhen: (_d, s) => s?.lived_2y === false,
    section: 'Current address' },
  { name: 'prior_address_zip', label: 'Prior Zip', type: 'text', placeholder: '07712',
    visibleWhen: (_d, s) => s?.lived_2y === false, requiredWhen: (_d, s) => s?.lived_2y === false,
    section: 'Current address' },
]

// Per-borrower experience fields (Step 3)
export const EXPERIENCE_FIELDS: FieldDef[] = [
  { name: 'flips_last_3y', label: 'Fix & Flips / Fix & Holds Completed Last 3 Years', type: 'select', options: FLIPS_COMPLETED_OPTIONS },
  { name: 'rental_units_owned', label: 'Number of Rental Units Currently Owned', type: 'number' },
  { name: 'other_re_experience', label: 'Other Real Estate Experience', type: 'select', options: OTHER_RE_EXPERIENCE_OPTIONS },
  { name: 'experience_explanation', label: 'Experience Explanation', type: 'textarea' },
]

// Per-borrower declarations (Step 4) - all yes/no
export const DECLARATION_FIELDS: FieldDef[] = [
  { name: 'd_liens', label: 'Do you have any outstanding liens or judgements against you?', type: 'yesno', required: true },
  { name: 'd_bankruptcy', label: 'Have you declared bankruptcy or had a foreclosure in the past 4 years?', type: 'yesno', required: true },
  { name: 'd_delinquent', label: 'Are you presently delinquent on any debt, lien, mortgage or financial obligation?', type: 'yesno', required: true },
  { name: 'd_foreclosure_obligation', label: 'Have you directly or indirectly been obligated on any loan which resulted in foreclosure, transfer of title in lieu of foreclosure, or judgement?', type: 'yesno', required: true },
  { name: 'd_lawsuit', label: 'Are you a party to a lawsuit?', type: 'yesno', required: true },
  { name: 'd_down_payment_borrowed', label: 'Is any part of the down payment borrowed?', type: 'yesno', required: true },
  { name: 'd_us_citizen', label: 'Are you a US Citizen?', type: 'yesno', required: true },
  { name: 'd_permanent_resident', label: 'Are you a permanent resident alien?', type: 'yesno', required: true },
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
  { name: 'has_deal', label: 'Do you have a deal?', type: 'yesno', required: true, section: 'Your deal' },
  { name: 'purchase_or_refi', label: 'Purchase or Refi', type: 'select', options: PURCHASE_REFI_OPTIONS, required: true, section: 'Your deal' },
  { name: 'loan_type', label: 'Loan Type', type: 'select', options: LOAN_TYPE_OPTIONS, required: true, section: 'Your deal' },
  { name: 'property_type', label: 'Property Type', type: 'select', required: true, section: 'Property',
    optionsWhen: (d) => isDSCR(d) ? PROPERTY_TYPE_OPTIONS_DSCR : PROPERTY_TYPE_OPTIONS_BRIDGE },
  { name: 'property_street', label: 'Property Address Line 1', type: 'text', required: true, placeholder: '789 Elm St', section: 'Property' },
  { name: 'property_city', label: 'City', type: 'text', required: true, placeholder: 'Toms River', section: 'Property' },
  { name: 'property_state', label: 'State', type: 'text', required: true, placeholder: 'NJ', section: 'Property' },
  { name: 'property_zip', label: 'Zip Code', type: 'text', required: true, placeholder: '08753', section: 'Property' },
  { name: 'deal_source', label: 'Deal Source', type: 'select', options: DEAL_SOURCE_OPTIONS, section: 'Property' },
  { name: 'number_of_units', label: 'Number of Units', type: 'number', section: 'Property',
    visibleWhen: (d) =>
      d.property_type === 'Multifamily (2-4 Units)' ||
      d.property_type === 'Multifamily (5+ Units)',
    requiredWhen: (d) =>
      d.property_type === 'Multifamily (2-4 Units)' ||
      d.property_type === 'Multifamily (5+ Units)' },
  { name: 'date_purchased', label: 'Date Purchased', type: 'date', visibleWhen: isPurchase, section: 'Refinance details' },
  { name: 'original_purchase_price', label: 'Original Purchase Price', type: 'currency', section: 'Refinance details' },
  { name: 'renovations_completed', label: 'Renovations Completed', type: 'currency', section: 'Refinance details' },
  { name: 'current_value', label: 'Current Value', type: 'currency', required: true, section: 'Refinance details' },
  { name: 'current_debt', label: 'Is There Current Debt on the Property?', type: 'yesno', visibleWhen: isRefi, section: 'Refinance details' },
  { name: 'debt_current_24mo', label: 'Has Debt Been Current Past 24 Months?', type: 'yesno', visibleWhen: (d) => isRefi(d) && d.current_debt === true, section: 'Refinance details' },
  { name: 'current_loan_balance', label: 'Current Loan Balance', type: 'currency', visibleWhen: isRefi, requiredWhen: isRefi, section: 'Refinance details' },
  { name: 'purchase_price', label: 'Purchase Price', type: 'currency', required: true, visibleWhen: isPurchase, section: 'Bridge loan details' },
  { name: 'construction_costs', label: 'Construction Costs', type: 'currency', visibleWhen: isBridge, requiredWhen: isBridge, section: 'Bridge loan details' },
  { name: 'after_repaired_value', label: 'After Repaired Value', type: 'currency', visibleWhen: isBridge, requiredWhen: isBridge, section: 'Bridge loan details' },
  { name: 'exit_strategy', label: 'Exit Strategy', type: 'select', options: EXIT_STRATEGY_OPTIONS, visibleWhen: isBridge, requiredWhen: isBridge, section: 'Bridge loan details' },
  { name: 'exit_strategy_other', label: 'Exit Strategy: Explain', type: 'textarea', visibleWhen: (d) => isBridge(d) && d.exit_strategy === 'Other (Explain Below)', section: 'Bridge loan details' },
  { name: 'total_monthly_rents', label: 'Total Monthly Rents (All Units)', type: 'currency', section: 'Rental income',
    visibleWhen: (d) => {
      const pt = d.property_type as string | undefined
      const dscrMulti = ['Multifamily (2 Units)', 'Multifamily (3 Units)', 'Multifamily (4 Units)', 'Multifamily (2-4 Units)']
      return (isDSCR(d) || pt === 'Multifamily (5+ Units)') && !dscrMulti.includes(pt ?? '')
    },
    requiredWhen: (d) => {
      const pt = d.property_type as string | undefined
      const dscrMulti = ['Multifamily (2 Units)', 'Multifamily (3 Units)', 'Multifamily (4 Units)', 'Multifamily (2-4 Units)']
      return (isDSCR(d) || pt === 'Multifamily (5+ Units)') && !dscrMulti.includes(pt ?? '')
    } },
  { name: 'requested_loan_amount', label: 'Requested Loan Amount', type: 'currency', section: 'Financing' },
  { name: 'cash_for_down_payment', label: 'Cash For Down Payment', type: 'currency', section: 'Financing',
    help: 'How much cash do the borrowers have available for a downpayment?' },
  { name: 'reserves_post_closing', label: 'Reserves Post Closing', type: 'currency', section: 'Financing',
    help: 'How much cash will borrowers have post closing? Include checking, savings, 401k, IRA etc.' },
  { name: 'annual_property_taxes', label: 'Annual Property Taxes', type: 'currency', section: 'Operating costs' },
  { name: 'annual_property_insurance', label: 'Annual Property Insurance', type: 'currency', section: 'Operating costs' },
  { name: 'monthly_flood_insurance', label: 'Monthly Flood Insurance', type: 'currency', section: 'Operating costs' },
  { name: 'monthly_hoa_dues', label: 'Monthly HOA Dues', type: 'currency', section: 'Operating costs' },
  { name: 'has_broker', label: 'Do you have an outside mortgage broker?', type: 'yesno', section: 'Mortgage broker' },
  { name: 'broker_name', label: "Broker's Name", type: 'text', placeholder: 'Jane Doe', section: 'Mortgage broker',
    visibleWhen: (d) => d.has_broker === true },
  { name: 'broker_company', label: "Broker's Company", type: 'text', visibleWhen: (d) => d.has_broker === true, section: 'Mortgage broker' },
  { name: 'broker_email', label: "Broker's Email", type: 'email', placeholder: 'broker@example.com', section: 'Mortgage broker',
    visibleWhen: (d) => d.has_broker === true },
  { name: 'broker_phone', label: "Broker's Phone", type: 'tel', placeholder: '(732) 555-0100', visibleWhen: (d) => d.has_broker === true, section: 'Mortgage broker' },
  { name: 'broker_fee', label: 'Broker Fee', type: 'text', placeholder: 'e.g. 1%', visibleWhen: (d) => d.has_broker === true, section: 'Mortgage broker' },
  { name: 'has_title_vendor', label: 'Do you have a preferred vendor for title insurance?', type: 'yesno', section: 'Title vendor' },
  { name: 'title_company', label: 'Title Company Name', type: 'text', placeholder: 'Acme Title Co.', section: 'Title vendor',
    visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'title_contact_name', label: 'Title Contact Name', type: 'text', placeholder: 'Jane Doe', visibleWhen: (d) => d.has_title_vendor === true, section: 'Title vendor' },
  { name: 'title_contact_email', label: 'Title Contact Email', type: 'email', placeholder: 'title@example.com', section: 'Title vendor',
    visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'title_contact_phone', label: 'Title Contact Phone', type: 'tel', placeholder: '(732) 555-0100', visibleWhen: (d) => d.has_title_vendor === true, section: 'Title vendor' },
  { name: 'has_insurance_vendor', label: 'Do you have a preferred vendor for property insurance?', type: 'yesno', section: 'Insurance vendor' },
  { name: 'insurance_company', label: 'Insurance Company Name', type: 'text', placeholder: 'Liberty Mutual', section: 'Insurance vendor',
    visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'insurance_contact_name', label: 'Insurance Contact Name', type: 'text', placeholder: 'John Smith', visibleWhen: (d) => d.has_insurance_vendor === true, section: 'Insurance vendor' },
  { name: 'insurance_contact_email', label: 'Insurance Contact Email', type: 'email', placeholder: 'insure@example.com', section: 'Insurance vendor',
    visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'insurance_contact_phone', label: 'Insurance Contact Phone', type: 'tel', placeholder: '(732) 555-0100', visibleWhen: (d) => d.has_insurance_vendor === true, section: 'Insurance vendor' },
  { name: 'other_details', label: 'Other Details', type: 'textarea', section: 'Notes' },
]

// Step 1 primary-only fields (in addition to BORROWER_FIELDS for the primary)
export const PRIMARY_EXTRA_FIELDS: FieldDef[] = [
  { name: 'housing_status', label: 'Housing Status', type: 'select', options: HOUSING_STATUS_OPTIONS, section: 'Housing' },
  { name: 'mortgage_on_primary', label: 'Is there a mortgage on your primary?', type: 'yesno', section: 'Housing' },
  { name: 'entity_name', label: 'Entity Name', type: 'text', placeholder: 'Smith Investments LLC', section: 'Entity (if applicable)' },
  { name: 'entity_type', label: 'Entity Type', type: 'select', options: ENTITY_TYPE_OPTIONS, section: 'Entity (if applicable)' },
  { name: 'loan_officer_assigned', label: 'First Equity Loan Officer', type: 'select', options: LOAN_OFFICER_OPTIONS, required: true, section: 'Application source' },
  { name: 'hear_about_us', label: 'How did you hear about us?', type: 'select', options: HEAR_ABOUT_OPTIONS, required: true, section: 'Application source' },
  { name: 'hear_about_details', label: 'Details', type: 'text', section: 'Application source' },
]

export interface UnitData { currently_rented?: boolean; current_rent?: number; market_rent?: number }
export const UNIT_FIELDS: FieldDef[] = [
  { name: 'currently_rented', label: 'Is this unit occupied?', type: 'yesno', required: true,
    help: 'Yes = currently leased to a tenant. No = vacant.' },
  { name: 'current_rent', label: 'Current Monthly Rent', type: 'currency',
    visibleWhen: (_d, s) => s?.currently_rented === true,
    requiredWhen: (_d, s) => s?.currently_rented === true },
  { name: 'market_rent', label: 'Estimated Market Rent', type: 'currency',
    visibleWhen: (_d, s) => s?.currently_rented === false,
    requiredWhen: (_d, s) => s?.currently_rented === false },
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
  subtitle: string
  estimateMinutes: number
}

export const STEPS: StepDef[] = [
  { id: 'borrower',      title: 'Borrower Info',   subtitle: "Help us understand who we're lending to and how to reach you.", estimateMinutes: 5 },
  { id: 'deal',          title: 'Deal Info',        subtitle: "Tell us about the property and the financing you're after.",   estimateMinutes: 4 },
  { id: 'experience',    title: 'Experience',       subtitle: "A few questions about your real estate background.",           estimateMinutes: 2 },
  { id: 'declarations',  title: 'Declarations',     subtitle: "Required disclosures about your financial and legal history.", estimateMinutes: 3 },
  { id: 'authorization', title: 'Authorization',    subtitle: "Review your application, then authorize and submit.",          estimateMinutes: 2 },
] as const

export const TOTAL_STEPS = STEPS.length
export const STEP_TITLES = STEPS.map(s => s.title) as string[]
export const MAX_CO_BORROWERS = 3 // 4 borrowers total

export const ALL_FIELDS: readonly FieldDef[] = [
  ...BORROWER_FIELDS,
  ...PRIMARY_EXTRA_FIELDS,
  ...DEAL_FIELDS,
  ...EXPERIENCE_FIELDS,
  ...DECLARATION_FIELDS,
  ...HMDA_FIELDS,
]

// ---- Per-step required-field gating ----
//
// Step → field-array mapping is derived by inspecting each step component:
//   Step 1 (borrower):      BORROWER_FIELDS + PRIMARY_EXTRA_FIELDS for primary;
//                           BORROWER_FIELDS for each co-borrower.
//   Step 2 (deal):          DEAL_FIELDS - scope is the form root (no prefix).
//   Step 3 (experience):    EXPERIENCE_FIELDS at the form root - none are required; returns [].
//   Step 4 (declarations):  DECLARATION_FIELDS + HMDA_FIELDS at the form root (no prefix).
//   Step 5 (authorization): auth_signature + payment_signature at the form root.
//
// Prefix convention mirrors submit/route.ts exactly:
//   primary fields  → "primary.<name>"
//   co-borrower N   → "coborrower<N>.<name>"  (1-indexed, no space)
//   deal / root     → "<name>"  (no prefix)
//
// Empty check: undefined | null | "" counts as empty.
// false and 0 are NOT empty (valid boolean/number answers).

export type StepId = "borrower" | "deal" | "experience" | "declarations" | "authorization"

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

export function getMissingRequiredFields(
  stepId: StepId,
  data: ApplicationData,
): string[] {
  const miss: string[] = []
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs: Record<string, unknown>[] = Array.isArray(data.co_borrowers)
    ? (data.co_borrowers as Record<string, unknown>[])
    : []

  if (stepId === "borrower") {
    // Primary: BORROWER_FIELDS + PRIMARY_EXTRA_FIELDS
    for (const f of [...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]) {
      if (isRequired(f, data, primary) && isEmpty(primary[f.name])) {
        miss.push(`primary.${f.name}`)
      }
    }
    // Co-borrowers: BORROWER_FIELDS only (no PRIMARY_EXTRA_FIELDS)
    for (let i = 0; i < cobs.length; i++) {
      const scope = cobs[i]
      const prefix = `coborrower${i + 1}`
      for (const f of BORROWER_FIELDS) {
        if (isRequired(f, data, scope) && isEmpty(scope[f.name])) {
          miss.push(`${prefix}.${f.name}`)
        }
      }
    }
  } else if (stepId === "deal") {
    // If has_deal is explicitly No, block Next with a synthetic entry so the
    // wizard shows the amber banner but does not scroll to a specific field.
    if (data.has_deal === false) {
      miss.push("has_deal")
      return miss
    }
    // Deal fields: scope is the form root - no borrower prefix
    for (const f of DEAL_FIELDS) {
      if (isRequired(f, data) && isEmpty(data[f.name])) {
        miss.push(f.name)
      }
    }
  } else if (stepId === "experience") {
    // EXPERIENCE_FIELDS are all optional - always returns []
    // Fields stored at root: data.flips_last_3y, data.rental_units_owned, etc.
  } else if (stepId === "declarations") {
    // DECLARATION_FIELDS + HMDA_FIELDS at root scope - one set for the whole application
    for (const f of [...DECLARATION_FIELDS, ...HMDA_FIELDS]) {
      if (isRequired(f, data) && isEmpty(data[f.name])) {
        miss.push(f.name)
      }
    }
  } else if (stepId === "authorization") {
    // Primary borrower signs the loan authorization. Signature stored at root: data.auth_signature
    if (isEmpty(data.auth_signature)) {
      miss.push("auth_signature")
    }
    // Payment authorization signature (combined step)
    if (isEmpty(data.payment_signature)) {
      miss.push("payment_signature")
    }
    // save_card_agree is gated in the UI (must check the box before saving card) - not server-validated here
  }

  return miss
}
