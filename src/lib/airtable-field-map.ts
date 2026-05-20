// Portal → Airtable Deals field mapping for the one-way "Loan Details" sync.
//
// This is the single source of truth for which portal columns push to which
// Airtable fields. Edit here when adding/changing a mapping; the sync code
// in src/lib/airtable.ts reads this directly.
//
// Origin of decisions: scripts/loan-details-mapping.csv (user-reviewed) +
// live Airtable schema verification + the three "Skip" decisions for
// read-only Airtable fields and conceptually-mismatched fields. See the
// conversation history for the full rationale.

import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Types
// ============================================================

/**
 * A scalar mapping: copy the portal value (with optional transform) into
 * the named Airtable field on the Deals row.
 */
export interface ScalarMapping {
  kind: 'scalar'
  portalCol: string                  // e.g. 'property_street'
  portalTable: 'loans' | 'loan_details'
  airtableField: string              // exact Airtable field name (case + spacing matter)
  /** Optional value transform; return undefined to skip writing this row's value. */
  transform?: (value: unknown) => unknown | undefined
}

/**
 * A vendor mapping: write to a linked table (Title / Insurance / Appraisers)
 * by find-or-create-by-company + link the record id onto the Deal's link
 * field. The vendor row also receives email/phone from the portal so the
 * Deal's lookup fields (Title Email, Title Phone, etc.) auto-populate.
 */
export interface VendorMapping {
  kind: 'vendor'
  /** Portal column holding the company name — required to drive the match. */
  portalCompanyCol: string           // e.g. 'title_company'
  /** Optional portal columns whose values get written onto the vendor row. */
  portalEmailCol?: string            // e.g. 'title_email'
  portalPhoneCol?: string            // e.g. 'title_phone'
  portalTable: 'loan_details'
  /** Link field on Deals that holds the multipleRecordLinks to the vendor row. */
  airtableLinkField: string          // e.g. 'Title'
  /** Vendor table id. */
  vendorTableId: string
  /** Field names inside the vendor table that we read/write. */
  vendorCompanyField: string         // e.g. 'Company'
  vendorEmailField?: string          // e.g. 'Email'
  vendorPhoneField?: string          // e.g. 'Phone'
}

export type FieldMapping = ScalarMapping | VendorMapping

// ============================================================
// Value transforms
// ============================================================

/** Portal 'Fix & Flip (Bridge)' / 'Rental (DSCR)' / 'New Construction'
 *  → Airtable 'Bridge' / 'DSCR' / 'New Construction'. */
function mapLoanType(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  if (v === 'Fix & Flip (Bridge)') return 'Bridge'
  if (v === 'Rental (DSCR)') return 'DSCR'
  if (v === 'New Construction') return 'New Construction'
  return undefined
}

/** Portal integer (12, 18, 360, 480) → Airtable text choice. */
function mapTermMonths(v: unknown): string | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  if (n === 12) return '12 Months'
  if (n === 18) return '18 Months'
  if (n === 360) return '360 Months'
  if (n === 480) return '480 Months'
  return undefined
}

/** Boolean → 'Yes' / 'No'. */
function boolToYesNo(v: unknown): string | undefined {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return undefined
}

/** Text already 'Yes'/'No' → pass through; anything else skipped. */
function passYesNoOnly(v: unknown): string | undefined {
  if (v === 'Yes' || v === 'No') return v
  return undefined
}

/** Portal Fixed / ARM → Airtable choices.
 *  ARM defaults to '5 yr ARM' since the portal doesn't distinguish 5/7. */
function mapRateType(v: unknown): string | undefined {
  if (v === 'Fixed') return 'fixed'
  if (v === 'ARM') return '5 yr ARM'
  return undefined
}

/** Annual → monthly (annual_property_tax → Monthly Property Tax). */
function annualToMonthly(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return Math.round((n / 12) * 100) / 100
}

/**
 * Portal's interest_rate is stored inconsistently (some 7.75, some 0.0775).
 * Airtable's Rate is a percent field, which always wants the fraction form.
 * Mirror the heuristic in src/lib/format-interest-rate.ts: anything >= 1 is
 * a whole-percent value that needs / 100.
 */
function normalizeRate(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n >= 1 ? n / 100 : n
}

/**
 * Portal's broker_points stored as a number (e.g. 1.5 = 1.5%).
 * Airtable's Broker Points is a percent field that wants a fraction.
 */
function pointsToFraction(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return n >= 1 ? n / 100 : n
}

// ============================================================
// The mapping
// ============================================================

/**
 * Airtable Deals table id (constant — base + table set up by hand).
 */
export const AIRTABLE_BASE_ID = 'appLaBD8QMTXAF0KJ'
export const AIRTABLE_DEALS_TABLE_ID = 'tbl0Dg6YE96oD9dDq'
export const AIRTABLE_DEAL_ID_FIELD = 'Pipedrive Deal ID'

/**
 * Linked vendor tables. The primary field on each is a formula ("Vendor"),
 * so we match/create on the writable Company field instead.
 *   Title:     Vendor (formula), Name, Company, Phone, Email, Deals
 *   Insurance: Vendor (formula), Name, Company, Address, Phone, Email, Deals
 *   Appraisers: Vendor (formula), Name, Company, Phone, Email, Deals, Toorak Approved
 */
const VENDOR_TABLES = {
  title:      { tableId: 'tblXZ6ucTk9FOotTM' },
  insurance:  { tableId: 'tbl6iKk1BFElA3zCD' },
  appraisers: { tableId: 'tblaDSAbqrH32EBQN' },
} as const

export const FIELD_MAP: FieldMapping[] = [
  // ---- Loan Overview (loans table) ----
  s('loan_number', 'loans', 'Loan Number'),
  s('loan_type', 'loans', 'Loan Type', mapLoanType),
  s('loan_amount', 'loans', 'Loan Amount'),
  s('interest_rate', 'loans', 'Rate', normalizeRate),
  // ltv: SKIP — Airtable LTV is a formula
  s('arv', 'loans', 'ARV Value'),
  s('rehab_budget', 'loans', 'Construction Cost'),
  s('term_months', 'loans', 'Loan Term', mapTermMonths),
  s('origination_date', 'loans', 'Closing Date'),
  s('maturity_date', 'loans', 'Maturity Date '),  // trailing space is intentional — that is the actual field name
  s('entity_name', 'loans', 'Entity'),

  // ---- Loan / Deal Overview (loan_details) ----
  s('investor_loan_number', 'loan_details', 'Investor Loan Number'),
  // loan_application: SKIP — portal stores free text, Airtable is a status singleSelect
  s('submitted_at', 'loan_details', 'Submitted'),
  s('urgency', 'loan_details', 'Urgency'),
  // reason_canceled: SKIP — portal stores free text, Airtable is a singleSelect with constrained choices
  s('underwriter_notes', 'loan_details', "Alicyn's Notes"),
  s('exceptions', 'loan_details', 'Exceptions'),
  s('cross_collateralization', 'loan_details', 'Cross Collaterization Flag ', boolToYesNo), // sic — Airtable typo + trailing space
  s('foreign_national', 'loan_details', 'Foreign National', boolToYesNo),

  // ---- Property Information ----
  s('property_street', 'loan_details', 'Property Street'),
  s('property_city', 'loan_details', 'Property City'),
  s('property_state', 'loan_details', 'Property State'),
  s('property_zip', 'loan_details', 'Property ZIP'),
  s('property_type', 'loan_details', 'Property Type'),
  s('number_of_units', 'loan_details', 'Number of Units', v => v == null ? undefined : String(v)),
  s('flood_zone', 'loan_details', 'Flood Zone', passYesNoOnly),
  // square_footage: SKIP — no Airtable match
  // units_vacant: SKIP — no Airtable match

  // ---- Loan Terms ----
  s('initial_loan_amount', 'loan_details', 'Initial Loan Amount'),
  s('cash_out_amount', 'loan_details', 'Cash Out Amt'),
  s('rate_type', 'loan_details', 'Rate Type', mapRateType),
  s('points', 'loan_details', 'Points'),
  s('broker_points', 'loan_details', 'Broker Points', pointsToFraction),
  // underwriting_fee: SKIP — Airtable Commitment Fee is a formula
  // legal_doc_prep_fee: SKIP — Airtable Attorney Fee is a formula
  s('prepayment_penalty', 'loan_details', 'Prepayment Penalty'),
  // amortization_schedule: SKIP — Airtable choices (Interst Only / 360 Months / 480 months) only partially overlap portal values (15/20/25/30-yr/Interest Only)
  s('first_payment_date', 'loan_details', 'First Payment Date'),
  s('loan_type_one', 'loan_details', 'Loan Purpose'),

  // ---- Borrower / Guarantor ----
  // coborrower_name/phone/email — all live on the Coborrowers linked table.
  // The portal stores a single co-borrower as free text fields. Writing a
  // linked record by name requires find-or-create logic on the Borrowers
  // table, which is a deeper integration. Skipping these in v1 — vendor
  // linked-table sync below shows the pattern if we want to extend later.
  // experience_borrower: SKIP — Airtable is a lookup (read-only)
  // experience_coborrower: SKIP — Airtable is a lookup (read-only)
  s('experience_notes', 'loan_details', 'Experience Notes'),
  s('number_of_properties', 'loan_details', 'Number of Properties '),  // trailing space — that is the actual field name
  s('verified_assets', 'loan_details', 'Verified Assets', v => {
    // portal stores as text (e.g. "$250k"); only push if it parses as a number
    if (typeof v !== 'string') return undefined
    const n = Number(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) && n > 0 ? n : undefined
  }),
  // liquid_assets_total: SKIP — no Airtable match

  // ---- Application Profile: ALL SKIP — no Airtable matches ----
  // own_or_rent, mortgage_on_primary, intent_to_occupy, down_payment_borrowed

  // ---- Credit / Background ----
  // credit_score_estimate: SKIP — no Airtable match
  // credit_frozen: SKIP — no Airtable match
  s('credit_report_date', 'loan_details', 'Credit Date'),
  // credit_score: SKIP — Airtable is a lookup (read-only)
  // background_check_date: SKIP — no Airtable match
  s('credit_background_notes', 'loan_details', 'Credit/Background Notes'),

  // ---- Appraisal / Review Tracking ----
  s('appraisal_received_date', 'loan_details', 'Appraisal Received Date'),
  // appraisal_effective_date: SKIP — no Airtable match

  // ---- Valuation / Collateral ----
  s('purchase_price', 'loan_details', 'Purchase Price'),
  s('acquisition_date', 'loan_details', 'Acquisition Date'),
  s('value_as_is', 'loan_details', 'As Is Value'),
  s('value_bpo', 'loan_details', 'BPO Value'),
  // payoff: SKIP — portal stores currency amount, Airtable Payoff is a status singleSelect

  // ---- Construction / Rehab ----
  s('construction_holdback', 'loan_details', 'Construction Holdback'),
  // draw_fee: SKIP — Airtable Draw Fee is a formula

  // ---- DSCR inputs ----
  s('qualifying_rent', 'loan_details', 'Qualifying Rent'),
  s('annual_insurance_premium', 'loan_details', 'HOI Premium'),
  s('annual_property_tax', 'loan_details', 'Monthly Property Tax', annualToMonthly),
  s('annual_flood_insurance', 'loan_details', 'Flood Insurance'),
  s('annual_hoa_dues', 'loan_details', 'Yearly HOA'),

  // ---- Vendors (linked tables) ----
  // Each maps the portal's company/email/phone trio to a row in Airtable's
  // Title / Insurance / Appraisers table. The Deal's email/phone lookup
  // fields auto-resolve once we link to the right row.
  {
    kind: 'vendor', portalTable: 'loan_details',
    portalCompanyCol: 'title_company',
    portalEmailCol: 'title_email',
    portalPhoneCol: 'title_phone',
    airtableLinkField: 'Title',
    vendorTableId: VENDOR_TABLES.title.tableId,
    vendorCompanyField: 'Company',
    vendorEmailField: 'Email',
    vendorPhoneField: 'Phone',
  },
  {
    kind: 'vendor', portalTable: 'loan_details',
    portalCompanyCol: 'insurance_company',
    portalEmailCol: 'insurance_email',
    portalPhoneCol: 'insurance_phone',
    airtableLinkField: 'Insurance',
    vendorTableId: VENDOR_TABLES.insurance.tableId,
    vendorCompanyField: 'Company',
    vendorEmailField: 'Email',
    vendorPhoneField: 'Phone',
  },
  {
    kind: 'vendor', portalTable: 'loan_details',
    portalCompanyCol: 'appraisal_company',
    portalEmailCol: 'appraisal_email',
    portalPhoneCol: 'appraisal_phone',
    airtableLinkField: 'Appraiser',
    vendorTableId: VENDOR_TABLES.appraisers.tableId,
    vendorCompanyField: 'Company',
    vendorEmailField: 'Email',
    vendorPhoneField: 'Phone',
  },

  // ---- Vesting Entity ----
  // vesting_in_entity, entity_type, entity_formation_state: ALL SKIP — no Airtable matches
]

// ============================================================
// Helpers used to keep the map declarations compact
// ============================================================

function s(
  portalCol: string,
  portalTable: 'loans' | 'loan_details',
  airtableField: string,
  transform?: ScalarMapping['transform'],
): ScalarMapping {
  return { kind: 'scalar', portalCol, portalTable, airtableField, transform }
}

// ============================================================
// Convenience accessors
// ============================================================

/** Columns we need to SELECT from `loans`. */
export function portalLoansColumns(): string[] {
  const cols = ['id', 'pipedrive_deal_id']
  for (const m of FIELD_MAP) {
    if (m.kind === 'scalar' && m.portalTable === 'loans' && !cols.includes(m.portalCol)) {
      cols.push(m.portalCol)
    }
  }
  return cols
}

/** Columns we need to SELECT from `loan_details`. */
export function portalLoanDetailsColumns(): string[] {
  const cols = ['loan_id']
  for (const m of FIELD_MAP) {
    if (m.portalTable !== 'loan_details') continue
    if (m.kind === 'scalar') {
      if (!cols.includes(m.portalCol)) cols.push(m.portalCol)
    } else {
      for (const c of [m.portalCompanyCol, m.portalEmailCol, m.portalPhoneCol]) {
        if (c && !cols.includes(c)) cols.push(c)
      }
    }
  }
  return cols
}

export interface VendorPayload {
  linkField: string                  // 'Title' / 'Insurance' / 'Appraiser'
  tableId: string                    // tbl... of the linked vendor table
  companyField: string               // 'Company'
  emailField?: string                // 'Email'
  phoneField?: string                // 'Phone'
  companyValue: string               // company name (used to match + create)
  emailValue?: string | null
  phoneValue?: string | null
}

/**
 * Build the Airtable fields object from a portal row pair. Returns the
 * payload to send to Airtable's PATCH endpoint (the `fields` object) plus
 * a list of linked-table vendors that need find-or-create before patching.
 */
export function buildAirtablePayload(
  loanRow: Record<string, unknown>,
  detailRow: Record<string, unknown> | null,
): { fields: Record<string, unknown>; vendors: VendorPayload[] } {
  const fields: Record<string, unknown> = {}
  const vendors: VendorPayload[] = []

  for (const m of FIELD_MAP) {
    if (m.kind === 'scalar') {
      const src = m.portalTable === 'loans' ? loanRow : (detailRow ?? {})
      const raw = src[m.portalCol]
      if (raw === null || raw === undefined) continue
      const value = m.transform ? m.transform(raw) : raw
      if (value === undefined) continue
      fields[m.airtableField] = value
    } else {
      // vendor — pull company (required), then email/phone if mapped
      const src = detailRow ?? {}
      const companyRaw = src[m.portalCompanyCol]
      if (typeof companyRaw !== 'string') continue
      const company = companyRaw.trim()
      if (!company) continue
      const emailRaw = m.portalEmailCol ? src[m.portalEmailCol] : null
      const phoneRaw = m.portalPhoneCol ? src[m.portalPhoneCol] : null
      vendors.push({
        linkField: m.airtableLinkField,
        tableId: m.vendorTableId,
        companyField: m.vendorCompanyField,
        emailField: m.vendorEmailField,
        phoneField: m.vendorPhoneField,
        companyValue: company,
        emailValue: typeof emailRaw === 'string' && emailRaw.trim() ? emailRaw.trim() : null,
        phoneValue: typeof phoneRaw === 'string' && phoneRaw.trim() ? phoneRaw.trim() : null,
      })
    }
  }

  return { fields, vendors }
}

// SupabaseClient is imported to keep type-only — we don't actually call
// supabase methods here; that's the sync code's job.
export type _PreventTypeErase = SupabaseClient
