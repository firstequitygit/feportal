// Loan Details ↔ Airtable Deals field mapping.
//
// SYNC MODEL: "portal wins, Airtable backfills"
//
//   Portal has value             → push portal → Airtable (overwrites)
//   Portal empty, Airtable value → pull Airtable → portal (fill the blank)
//   Both empty                   → no-op
//
// Portal is the source of truth. Airtable still backfills the portal on
// fields the portal hasn't populated yet, but a populated portal field
// always overwrites Airtable on the next sync.
//
// Edit this file to add/change a mapping. The reconciliation engine in
// src/lib/airtable.ts reads it directly.

import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Types
// ============================================================

/**
 * A scalar mapping: copy values between a portal column and a named
 * Airtable field on the Deals row, with optional bidirectional transforms.
 */
export interface ScalarMapping {
  kind: 'scalar'
  portalCol: string                  // e.g. 'property_street'
  portalTable: 'loans' | 'loan_details'
  airtableField: string              // exact Airtable field name (case + spacing matter)
  /** Portal value → Airtable value. Return undefined to skip pushing. */
  toAirtable?: (v: unknown) => unknown | undefined
  /** Airtable value → portal value. Return undefined to skip pulling. */
  toPortal?: (v: unknown) => unknown | undefined
}

/**
 * A vendor mapping: bidirectional sync between a portal company/email/phone
 * trio and a row in one of Airtable's linked vendor tables
 * (Title / Insurance / Appraisers).
 *
 * Push direction (portal → Airtable, only when the Deal has no link yet):
 *   - find-or-create a vendor row matching the portal's company name
 *   - link it to the Deal's airtableLinkField
 *   - fill the vendor row's Email / Phone if portal has them
 *
 * Pull direction (Airtable → portal, only when portal columns are empty):
 *   - read the linked vendor row's Company / Email / Phone
 *   - copy each into portal where portal is blank
 */
export interface VendorMapping {
  kind: 'vendor'
  /** Portal column holding the company name — required to drive the match. */
  portalCompanyCol: string           // e.g. 'title_company'
  portalEmailCol?: string            // e.g. 'title_email'
  portalPhoneCol?: string            // e.g. 'title_phone'
  portalTable: 'loan_details'
  airtableLinkField: string          // 'Title' / 'Insurance' / 'Appraiser'
  vendorTableId: string
  vendorCompanyField: string         // 'Company'
  vendorEmailField?: string          // 'Email'
  vendorPhoneField?: string          // 'Phone'
}

export type FieldMapping = ScalarMapping | VendorMapping

// ============================================================
// Value transforms (forward = portal→Airtable, inverse = Airtable→portal)
// ============================================================

// ---- loan_type ----
function mapLoanTypeForward(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  if (v === 'Fix & Flip (Bridge)') return 'Bridge'
  if (v === 'Rental (DSCR)') return 'DSCR'
  if (v === 'New Construction') return 'New Construction'
  return undefined
}
function mapLoanTypeInverse(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  if (v === 'Bridge') return 'Fix & Flip (Bridge)'
  if (v === 'DSCR') return 'Rental (DSCR)'
  if (v === 'New Construction') return 'New Construction'
  return undefined
}

// ---- term_months ----
function mapTermMonthsForward(v: unknown): string | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  if ([12, 18, 360, 480].includes(n)) return `${n} Months`
  return undefined
}
function mapTermMonthsInverse(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const m = v.match(/^(\d+)\s*Months?$/i)
  return m ? Number(m[1]) : undefined
}

// ---- booleans ↔ Yes/No singleSelect ----
function boolToYesNo(v: unknown): string | undefined {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return undefined
}
function yesNoToBool(v: unknown): boolean | undefined {
  if (v === 'Yes') return true
  if (v === 'No') return false
  return undefined
}

// ---- flood_zone (portal stores 'Yes'/'No' as text, Airtable is singleSelect 'Yes'/'No') ----
function passYesNoOnly(v: unknown): string | undefined {
  if (v === 'Yes' || v === 'No') return v
  return undefined
}

// ---- pipeline_stage ↔ Airtable "Loan Status" ----
// Portal → Airtable. Conditionally Approved collapses to Underwriting
// (portal-only refinement). New Application returns undefined because
// those loans don't exist in Airtable yet — Airtable rows get created
// downstream when the deal moves into Processing in Pipedrive.
function mapStageForward(v: unknown): string | undefined {
  if (v === 'New Application')        return undefined
  if (v === 'Processing')              return 'Processing'
  if (v === 'Pre-Underwriting')        return 'Pre-Underwriting'
  if (v === 'Underwriting')            return 'Underwriting'
  if (v === 'Conditionally Approved')  return 'Underwriting'  // CA collapses
  if (v === 'Approved')                return 'Submitted'      // Airtable calls it Submitted
  if (v === 'Closed')                  return 'Closed'
  return undefined
}
// Airtable → Portal. Only fires when portal pipeline_stage is empty
// (sync model is "portal wins, Airtable backfills"). Canceled / On Hold
// are lifecycle states owned by loan_status, not pipeline_stage — return
// undefined for those so they don't get written into the wrong column.
function mapStageInverse(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  switch (v) {
    case 'Processing':       return 'Processing'
    case 'Pre-Underwriting': return 'Pre-Underwriting'
    case 'Underwriting':     return 'Underwriting'
    case 'Submitted':        return 'Approved'
    case 'Closed':           return 'Closed'
    default:                 return undefined  // Canceled / On Hold / etc.
  }
}

// ---- loan_type_one ↔ Airtable "Loan Purpose" ----
// Portal stores the long-form labels staff have always used; Airtable
// uses shorter ones. Map both directions explicitly so the sync doesn't
// get tripped by INVALID_MULTIPLE_CHOICE_OPTIONS on the push.
//
//   Portal                       Airtable
//   ------------------------     ----------------
//   Purchase                  ↔  Purchase
//   Delayed Purchase          ↔  Delayed Purchase
//   Refinance (no cash out)   ↔  Rate/Term Refi
//   Refinance (cash out)      ↔  Cash Out Refi
function mapLoanPurposeForward(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  switch (v) {
    case 'Purchase':                return 'Purchase'
    case 'Delayed Purchase':        return 'Delayed Purchase'
    case 'Refinance (no cash out)': return 'Rate/Term Refi'
    case 'Refinance (cash out)':    return 'Cash Out Refi'
    default:                        return undefined
  }
}
function mapLoanPurposeInverse(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  switch (v) {
    case 'Purchase':         return 'Purchase'
    case 'Delayed Purchase': return 'Delayed Purchase'
    case 'Rate/Term Refi':   return 'Refinance (no cash out)'
    case 'Cash Out Refi':    return 'Refinance (cash out)'
    default:                 return undefined
  }
}

// ---- rate_type ----
// Airtable's Rate Type singleSelect has 'Fixed', '5 Year ARM', '7 Year ARM'.
// The portal only stores 'Fixed' or 'ARM' (no 5 vs 7 distinction), so we
// default ARM → '5 Year ARM' on push and accept either ARM variant on pull.
function mapRateTypeForward(v: unknown): string | undefined {
  if (v === 'Fixed') return 'Fixed'
  if (v === 'ARM') return '5 Year ARM'
  return undefined
}
function mapRateTypeInverse(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  if (v.toLowerCase() === 'fixed') return 'Fixed'   // accept "Fixed" or "fixed"
  if (/arm$/i.test(v)) return 'ARM'                 // accept "5 Year ARM" / "7 Year ARM" / "ARM"
  return undefined
}

// ---- annual ↔ monthly (annual_property_tax ↔ Monthly Property Tax) ----
function annualToMonthly(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return Math.round((n / 12) * 100) / 100
}
function monthlyToAnnual(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return Math.round(n * 12 * 100) / 100
}

// ---- interest_rate (portal stores 7.75 or 0.0775 inconsistently;
//      Airtable percent stores fraction form 0.0775) ----
function rateForward(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n >= 1 ? n / 100 : n
}
function rateInverse(v: unknown): number | undefined {
  // Airtable percent → portal. Write the fraction form (0.0775) — the
  // portal's smart formatter (src/lib/format-interest-rate.ts) handles
  // either form, so storing the fraction is unambiguous.
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

// ---- broker_points (Airtable percent fraction; portal stores 1.5 = 1.5%) ----
function pointsForward(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return n >= 1 ? n / 100 : n
}
function pointsInverse(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  // Airtable fraction (0.015) → portal "1.5"
  return n < 1 ? Math.round(n * 100 * 1000) / 1000 : n
}

// ---- verified_assets (portal text e.g. "$250k" or "250000"; Airtable currency) ----
function verifiedAssetsForward(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const n = Number(v.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}
function verifiedAssetsInverse(v: unknown): string | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return String(n)
}

// ---- number_of_units (Airtable singleLineText; portal integer) ----
function numToText(v: unknown): string | undefined {
  return v == null ? undefined : String(v)
}
function textToInt(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

// ============================================================
// Constants
// ============================================================

export const AIRTABLE_BASE_ID = 'appLaBD8QMTXAF0KJ'
export const AIRTABLE_DEALS_TABLE_ID = 'tbl0Dg6YE96oD9dDq'
export const AIRTABLE_DEAL_ID_FIELD = 'Pipedrive Deal ID'

const VENDOR_TABLES = {
  title:      { tableId: 'tblXZ6ucTk9FOotTM' },
  insurance:  { tableId: 'tbl6iKk1BFElA3zCD' },
  appraisers: { tableId: 'tblaDSAbqrH32EBQN' },
} as const

// ============================================================
// The mapping
// ============================================================

export const FIELD_MAP: FieldMapping[] = [
  // ---- Loan Overview (loans table) ----
  // ---- pipeline_stage ↔ "Loan Status" ----
  // Airtable's "Loan Status" singleSelect doubles as the pipeline stage
  // AND the on-hold / canceled lifecycle state. The lifecycle states are
  // owned by pushLoanStatusToAirtable; this mapping handles the stages.
  // syncLoanToAirtable skips this field when the portal's loan_status is
  // on_hold/cancelled so the two systems don't fight over the column.
  //
  // Mapping (per FE workflow):
  //   New Application       → (skip — these loans haven't been pushed to Airtable yet)
  //   Processing            → Processing
  //   Pre-Underwriting      → Pre-Underwriting
  //   Underwriting          → Underwriting
  //   Conditionally Approved → Underwriting  (portal-only refinement)
  //   Approved              → Submitted
  //   Closed                → Closed
  s('pipeline_stage', 'loans', 'Loan Status', mapStageForward, mapStageInverse),
  s('loan_number', 'loans', 'Loan Number'),
  s('loan_type', 'loans', 'Loan Type', mapLoanTypeForward, mapLoanTypeInverse),
  s('loan_amount', 'loans', 'Loan Amount'),
  s('interest_rate', 'loans', 'Rate', rateForward, rateInverse),
  s('arv', 'loans', 'ARV Value'),
  s('rehab_budget', 'loans', 'Construction Cost'),
  s('term_months', 'loans', 'Loan Term', mapTermMonthsForward, mapTermMonthsInverse),
  s('origination_date', 'loans', 'Closing Date'),
  s('maturity_date', 'loans', 'Maturity Date '),  // trailing space — actual name
  s('entity_name', 'loans', 'Entity'),
  // Portal text 'Yes' / 'No' ↔ Airtable singleSelect 'Yes' / 'No'.
  // Direct passthrough — no transform needed.
  s('rate_lock_extended', 'loans', 'Rate Lock Extended'),

  // ---- Loan / Deal Overview ----
  s('investor_loan_number', 'loan_details', 'Investor Loan Number'),
  s('min_number',           'loan_details', 'Min #'),
  s('funded_date',          'loan_details', 'Funding Date'),
  s('submitted_at', 'loan_details', 'Submitted'),
  s('urgency', 'loan_details', 'Urgency'),
  s('investor', 'loan_details', 'Investor'),
  s('underwriter_notes', 'loan_details', "Alicyn's Notes"),
  s('exceptions', 'loan_details', 'Exceptions'),
  s('cross_collateralization', 'loan_details', 'Cross Collaterization Flag ', boolToYesNo, yesNoToBool),
  s('foreign_national', 'loan_details', 'Foreign National', boolToYesNo, yesNoToBool),

  // ---- Property Information ----
  s('property_street', 'loan_details', 'Property Street'),
  s('property_city', 'loan_details', 'Property City'),
  s('property_state', 'loan_details', 'Property State'),
  s('property_zip', 'loan_details', 'Property ZIP'),
  s('property_type', 'loan_details', 'Property Type'),
  s('number_of_units', 'loan_details', 'Number of Units', numToText, textToInt),
  s('flood_zone', 'loan_details', 'Flood Zone', passYesNoOnly, passYesNoOnly),

  // ---- Loan Terms ----
  s('initial_loan_amount', 'loan_details', 'Initial Loan Amount'),
  s('cash_out_amount', 'loan_details', 'Cash Out Amt'),
  s('rate_type', 'loan_details', 'Rate Type', mapRateTypeForward, mapRateTypeInverse),
  s('points', 'loan_details', 'Points'),
  s('broker_points', 'loan_details', 'Broker Points', pointsForward, pointsInverse),
  s('broker_ysp',    'loan_details', 'Broker YSP',    pointsForward, pointsInverse),
  // Two more points-style fields on the Loan Terms card. Same percent ↔
  // fraction handling as Broker Points / Broker YSP.
  s('rate_costs_points',            'loan_details', 'Extension Cost - Points', pointsForward, pointsInverse),
  s('other_exception_costs_points', 'loan_details', 'SLV/Exception Points',    pointsForward, pointsInverse),
  // Desk Review Fee + Small Balance Fee are Airtable formula fields.
  // The schema-based READ_ONLY_FIELD_TYPES guard in syncLoanToAirtable
  // automatically skips push attempts on formula fields, so these end
  // up effectively pull-only (Airtable computes → portal mirrors).
  // Feasibility Fee + Additional Fees are normal currency fields and
  // sync bidirectionally per the standard "portal wins, Airtable
  // backfills" model.
  s('desk_review_fee',   'loan_details', 'Desk Review Fee'),
  s('small_balance_fee', 'loan_details', 'Small Balance Fee'),
  s('feasibility_fee',   'loan_details', 'Feasibility Fee'),
  s('additional_fees',   'loan_details', 'Additional Fees'),
  s('prepayment_penalty', 'loan_details', 'Prepayment Penalty'),
  s('first_payment_date', 'loan_details', 'First Payment Date'),
  s('loan_type_one', 'loan_details', 'Loan Purpose', mapLoanPurposeForward, mapLoanPurposeInverse),

  // ---- Borrower / Guarantor ----
  s('experience_notes', 'loan_details', 'Experience Notes'),
  s('number_of_properties', 'loan_details', 'Number of Properties '),  // trailing space
  s('verified_assets', 'loan_details', 'Verified Assets', verifiedAssetsForward, verifiedAssetsInverse),

  // ---- Credit / Background ----
  s('credit_report_date', 'loan_details', 'Credit Date'),
  s('credit_background_notes', 'loan_details', 'Credit/Background Notes'),

  // ---- Appraisal / Review Tracking ----
  s('appraisal_received_date', 'loan_details', 'Appraisal Received Date'),
  s('appraisal_paid_date', 'loan_details', 'Appraisal Paid Date'),

  // ---- Valuation / Collateral ----
  s('purchase_price', 'loan_details', 'Purchase Price'),
  s('acquisition_date', 'loan_details', 'Acquisition Date'),
  s('value_as_is', 'loan_details', 'As Is Value'),
  s('value_bpo', 'loan_details', 'BPO Value'),

  // ---- Construction / Rehab ----
  s('construction_holdback', 'loan_details', 'Construction Holdback'),

  // ---- DSCR inputs ----
  s('qualifying_rent', 'loan_details', 'Qualifying Rent'),
  s('annual_insurance_premium', 'loan_details', 'HOI Premium'),
  s('annual_property_tax', 'loan_details', 'Monthly Property Tax', annualToMonthly, monthlyToAnnual),
  s('annual_flood_insurance', 'loan_details', 'Flood Insurance'),
  s('annual_hoa_dues', 'loan_details', 'Yearly HOA'),

  // ---- Vendors (linked tables) ----
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
]

// ============================================================
// Helpers
// ============================================================

function s(
  portalCol: string,
  portalTable: 'loans' | 'loan_details',
  airtableField: string,
  toAirtable?: ScalarMapping['toAirtable'],
  toPortal?: ScalarMapping['toPortal'],
): ScalarMapping {
  return { kind: 'scalar', portalCol, portalTable, airtableField, toAirtable, toPortal }
}

/** Treat null / undefined / empty string / empty array as "empty". */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string' && v.trim() === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

/** Columns we need to SELECT from `loans`. */
export function portalLoansColumns(): string[] {
  // loan_status isn't in FIELD_MAP (it's not a synced column — it's the
  // lifecycle state owned by /api/loans/status), but syncLoanToAirtable
  // needs to read it to know whether to skip the pipeline_stage push so
  // it doesn't fight pushLoanStatusToAirtable over the "Loan Status" cell.
  const cols = ['id', 'pipedrive_deal_id', 'loan_status']
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

/** The list of Airtable field names we need to read from a Deals row. */
export function airtableFieldsToRead(): string[] {
  const fields = new Set<string>()
  for (const m of FIELD_MAP) {
    if (m.kind === 'scalar') fields.add(m.airtableField)
    else fields.add(m.airtableLinkField)
  }
  return [...fields]
}

// SupabaseClient is imported to keep type-only — we don't actually call
// supabase methods here.
export type _PreventTypeErase = SupabaseClient
