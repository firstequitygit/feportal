// Canonical list of every field that appears in the Loan Details
// card, keyed by a stable string id. Used in two places:
//
//   1. The card itself tags each row with a `fieldKey` so the saved-
//      view filter can decide whether to render it.
//   2. The Manage Views modal walks this list to render the
//      checkbox grid grouped by section.
//
// Add a new field here when you add a new row to loan-details-card.tsx
// — and use the same key as the `fieldKey` prop. The key has to be
// stable across schema changes because it ends up persisted in the
// saved-view's hidden_fields jsonb column. Don't rename keys; if a
// field moves between sections, change `section` but keep `key`.
//
// Read-only calculated rows (Monthly Payment, DSCR, Credit Days Left,
// Appraisal Days Left) are intentionally NOT in this list — they
// always render with their parent section's other fields. Users who
// want them hidden can hide the whole section's contents.

export interface LoanDetailsFieldDef {
  /** Stable string id. Persisted in saved views — DO NOT rename. */
  key: string
  /** Human label as shown in the card row. */
  label: string
  /** Section heading the field is grouped under in the card. */
  section: string
}

export const LOAN_DETAILS_SECTIONS = [
  'Loan / Deal Overview',
  'Property Information',
  'Loan Terms',
  'Vendors (Title, Insurance, Appraiser)',
  'Vesting Entity',
  'Borrower / Guarantor',
  'Application Profile',
  'Credit / Background',
  'Appraisal / Review Tracking',
  'Valuation / Collateral',
  'Construction / Rehab',
  'DSCR',
  'Declarations',
] as const

export const LOAN_DETAILS_FIELDS: LoanDetailsFieldDef[] = [
  // Loan / Deal Overview
  { key: 'created_at',             label: 'Created',                section: 'Loan / Deal Overview' },
  { key: 'submitted_at',           label: 'Submitted',              section: 'Loan / Deal Overview' },
  { key: 'origination_date',       label: 'Origination Date',       section: 'Loan / Deal Overview' },
  { key: 'maturity_date',          label: 'Maturity Date',          section: 'Loan / Deal Overview' },
  { key: 'funded_date',            label: 'Funded Date',            section: 'Loan / Deal Overview' },
  { key: 'investor_loan_number',   label: 'Investor Loan Number',   section: 'Loan / Deal Overview' },
  { key: 'min_number',             label: 'MIN #',                  section: 'Loan / Deal Overview' },
  { key: 'loan_application',       label: 'Loan Application',       section: 'Loan / Deal Overview' },
  { key: 'urgency',                label: 'Urgency',                section: 'Loan / Deal Overview' },
  { key: 'investor',               label: 'Investor',               section: 'Loan / Deal Overview' },
  { key: 'cross_collateralization', label: 'Cross Collateralization', section: 'Loan / Deal Overview' },
  { key: 'foreign_national',       label: 'Foreign National',       section: 'Loan / Deal Overview' },
  { key: 'reason_canceled',        label: 'Reason Canceled',        section: 'Loan / Deal Overview' },
  { key: 'underwriter_notes',      label: "Underwriter's Notes",    section: 'Loan / Deal Overview' },
  { key: 'exceptions',             label: 'Exceptions',             section: 'Loan / Deal Overview' },

  // Property Information
  { key: 'property_street',        label: 'Street',                 section: 'Property Information' },
  { key: 'property_city',          label: 'City',                   section: 'Property Information' },
  { key: 'property_state',         label: 'State',                  section: 'Property Information' },
  { key: 'property_zip',           label: 'ZIP',                    section: 'Property Information' },
  { key: 'property_type',          label: 'Property Type',          section: 'Property Information' },
  { key: 'number_of_units',        label: 'Number of Units',        section: 'Property Information' },
  { key: 'square_footage',         label: 'Square Footage',         section: 'Property Information' },
  { key: 'units_vacant',           label: 'Vacant Units',           section: 'Property Information' },
  { key: 'flood_zone',             label: 'Flood Zone',             section: 'Property Information' },

  // Loan Terms
  { key: 'loan_type_one',          label: 'Loan Purpose',                   section: 'Loan Terms' },
  { key: 'initial_loan_amount',    label: 'Initial Loan Amount',            section: 'Loan Terms' },
  { key: 'cash_out_amount',        label: 'Cash-Out Amount',                section: 'Loan Terms' },
  { key: 'rate_type',              label: 'Rate Type',                      section: 'Loan Terms' },
  { key: 'points',                 label: 'Points',                         section: 'Loan Terms' },
  { key: 'rate_costs_points',      label: 'Extension Costs - Points',       section: 'Loan Terms' },
  { key: 'other_exception_costs_points', label: 'Other/Exception Costs - Points', section: 'Loan Terms' },
  { key: 'broker_points',          label: 'Broker Points',                  section: 'Loan Terms' },
  { key: 'broker_ysp',             label: 'Broker YSP',                     section: 'Loan Terms' },
  { key: 'underwriting_fee',       label: 'Underwriting Fee',               section: 'Loan Terms' },
  { key: 'legal_doc_prep_fee',     label: 'Legal/Doc Prep Fee',             section: 'Loan Terms' },
  { key: 'desk_review_fee',        label: 'Desk Review Fee',                section: 'Loan Terms' },
  { key: 'small_balance_fee',      label: 'Small Balance Fee',              section: 'Loan Terms' },
  { key: 'feasibility_fee',        label: 'Feasibility Fee',                section: 'Loan Terms' },
  { key: 'additional_fees',        label: 'Additional Fees',                section: 'Loan Terms' },
  { key: 'additional_fees_notes',  label: 'Additional Fees — Notes',        section: 'Loan Terms' },
  { key: 'prepayment_penalty',     label: 'Prepayment Penalty',             section: 'Loan Terms' },
  { key: 'amortization_schedule',  label: 'Amortization Schedule',          section: 'Loan Terms' },
  { key: 'first_payment_date',     label: 'First Payment Date',             section: 'Loan Terms' },

  // Vendors
  { key: 'title_company',          label: 'Title Company / Agent',          section: 'Vendors (Title, Insurance, Appraiser)' },
  { key: 'title_email',            label: 'Title Email',                    section: 'Vendors (Title, Insurance, Appraiser)' },
  { key: 'title_phone',            label: 'Title Phone',                    section: 'Vendors (Title, Insurance, Appraiser)' },
  { key: 'insurance_company',      label: 'Insurance Company / Agent',      section: 'Vendors (Title, Insurance, Appraiser)' },
  { key: 'insurance_email',        label: 'Insurance Email',                section: 'Vendors (Title, Insurance, Appraiser)' },
  { key: 'insurance_phone',        label: 'Insurance Phone',                section: 'Vendors (Title, Insurance, Appraiser)' },
  { key: 'appraisal_company',      label: 'Appraiser / Appraisal Company',  section: 'Vendors (Title, Insurance, Appraiser)' },
  { key: 'appraisal_email',        label: 'Appraiser Email',                section: 'Vendors (Title, Insurance, Appraiser)' },
  { key: 'appraisal_phone',        label: 'Appraiser Phone',                section: 'Vendors (Title, Insurance, Appraiser)' },

  // Vesting Entity
  { key: 'vesting_in_entity',      label: 'Vesting in Entity?',             section: 'Vesting Entity' },
  { key: 'entity_type',            label: 'Entity Type',                    section: 'Vesting Entity' },
  { key: 'entity_formation_state', label: 'Formation State',                section: 'Vesting Entity' },

  // Borrower / Guarantor
  { key: 'coborrower_name',        label: 'Co-Borrower Name',               section: 'Borrower / Guarantor' },
  { key: 'coborrower_phone',       label: 'Co-Borrower Phone',              section: 'Borrower / Guarantor' },
  { key: 'coborrower_email',       label: 'Co-Borrower Email',              section: 'Borrower / Guarantor' },
  { key: 'experience_borrower',    label: 'Borrower Experience',            section: 'Borrower / Guarantor' },
  { key: 'experience_coborrower',  label: 'Co-Borrower Experience',         section: 'Borrower / Guarantor' },
  { key: 'number_of_properties',   label: 'Number of Properties',           section: 'Borrower / Guarantor' },
  { key: 'verified_assets',        label: 'Verified Assets',                section: 'Borrower / Guarantor' },
  { key: 'liquid_assets_total',    label: 'Liquid Assets Total',            section: 'Borrower / Guarantor' },
  { key: 'experience_notes',       label: 'Experience Notes',               section: 'Borrower / Guarantor' },

  // Application Profile
  { key: 'own_or_rent',            label: 'Own or Rent (current home)',     section: 'Application Profile' },
  { key: 'mortgage_on_primary',    label: 'Mortgage on Primary Residence',  section: 'Application Profile' },
  { key: 'intent_to_occupy',       label: 'Intent to Occupy Subject Property', section: 'Application Profile' },
  { key: 'down_payment_borrowed',  label: 'Down Payment Borrowed',          section: 'Application Profile' },

  // Credit / Background
  { key: 'credit_score_estimate',  label: 'Credit Score (Estimate)',        section: 'Credit / Background' },
  { key: 'credit_frozen',          label: 'Credit Frozen',                  section: 'Credit / Background' },
  { key: 'credit_report_date',     label: 'Credit Report Date',             section: 'Credit / Background' },
  { key: 'credit_score',           label: 'Credit Score (Pulled)',          section: 'Credit / Background' },
  { key: 'background_check_date',  label: 'Background Check Date',          section: 'Credit / Background' },
  { key: 'credit_background_notes', label: 'Credit / Background Notes',     section: 'Credit / Background' },

  // Appraisal / Review Tracking
  { key: 'appraisal_order_date',     label: 'Appraisal Order Date',         section: 'Appraisal / Review Tracking' },
  { key: 'appraisal_paid_date',      label: 'Appraisal Paid Date',          section: 'Appraisal / Review Tracking' },
  { key: 'appraisal_received_date',  label: 'Appraisal Received Date',      section: 'Appraisal / Review Tracking' },
  { key: 'appraisal_effective_date', label: 'Appraisal Effective Date',     section: 'Appraisal / Review Tracking' },

  // Valuation / Collateral
  { key: 'purchase_price',         label: 'Purchase Price',                 section: 'Valuation / Collateral' },
  { key: 'acquisition_date',       label: 'Acquisition Date',               section: 'Valuation / Collateral' },
  { key: 'value_as_is',            label: 'Value (As-Is)',                  section: 'Valuation / Collateral' },
  { key: 'arv',                    label: 'Value (ARV)',                    section: 'Valuation / Collateral' },
  { key: 'value_bpo',              label: 'Value (BPO)',                    section: 'Valuation / Collateral' },
  { key: 'payoff',                 label: 'Payoff',                         section: 'Valuation / Collateral' },

  // Construction / Rehab
  { key: 'construction_holdback',  label: 'Construction Holdback',          section: 'Construction / Rehab' },
  { key: 'draw_fee',               label: 'Draw Fee',                       section: 'Construction / Rehab' },

  // DSCR
  { key: 'qualifying_rent',        label: 'Qualifying Rent (monthly)',      section: 'DSCR' },
  { key: 'annual_property_tax',    label: 'Annual Property Tax',            section: 'DSCR' },
  { key: 'annual_insurance_premium', label: 'Annual Insurance Premium',     section: 'DSCR' },
  { key: 'annual_flood_insurance', label: 'Annual Flood Insurance',         section: 'DSCR' },
  { key: 'annual_hoa_dues',        label: 'Annual HOA Dues',                section: 'DSCR' },

  // Declarations — single grouped block; hiding all of these effectively
  // collapses the section to just the explanation when present.
  { key: 'declarations',           label: 'Declarations (all)',             section: 'Declarations' },
]

/** Quick lookup by key — used inside the card to test hidden state. */
export const LOAN_DETAILS_FIELD_KEYS: Set<string> = new Set(
  LOAN_DETAILS_FIELDS.map(f => f.key),
)

/** Group the field list by section for the manage-views modal. */
export function loanDetailsFieldsBySection(): Array<{
  section: string
  fields: LoanDetailsFieldDef[]
}> {
  const map = new Map<string, LoanDetailsFieldDef[]>()
  for (const f of LOAN_DETAILS_FIELDS) {
    const arr = map.get(f.section) ?? []
    arr.push(f)
    map.set(f.section, arr)
  }
  // Preserve LOAN_DETAILS_SECTIONS order rather than insertion order so
  // the modal columns always match the card layout.
  return LOAN_DETAILS_SECTIONS
    .map(s => ({ section: s, fields: map.get(s) ?? [] }))
    .filter(s => s.fields.length > 0)
}
