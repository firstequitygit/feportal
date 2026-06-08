// Underwriter data tape — single denormalized row per loan with every
// field Alicyn tracks in her Airtable view.
//
// Filter rules (mirroring the Airtable share, minus the noise):
//   - archived = false        (closed-and-archived loans drop off)
//   - pipeline_stage != 'New Application'
//   - pipeline_stage IS NOT NULL  ("Empty" in Alicyn's view)
//   - loan_status != 'on_hold'   (paused deals not actively underwriting)
//
// Scale guard: capped at MAX_ROWS most-recent loans because the
// joined+denormalized payload of ~50 columns × 2k+ loans easily
// exceeds Vercel's per-response size cap (4.5 MB). The data-tape UI
// surfaces the cap in a banner when we hit it. Adjust the constant
// once we move to a paginated/streaming surface.
//
// The column set deliberately matches docs/airtable-field-map.csv —
// those are the fields already chosen as the source of truth between
// portal and Alicyn's base, so the data tape mirrors them 1:1.

import type { SupabaseClient } from '@supabase/supabase-js'

export const DATA_TAPE_MAX_ROWS = 500

export interface DataTapeRow {
  // ---- Identifiers ----
  id: string
  property_address: string | null
  loan_number: string | null
  investor_loan_number: string | null
  min_number: string | null
  pipeline_stage: string | null
  loan_status: string | null

  // ---- People ----
  borrower_name: string | null
  loan_officer_name: string | null
  loan_processor_name: string | null
  underwriter_name: string | null
  broker_name: string | null
  broker_company: string | null

  // ---- Loan structure (loans table) ----
  loan_type: string | null
  loan_amount: number | null
  interest_rate: number | null
  ltv: number | null
  arv: number | null
  rehab_budget: number | null
  term_months: number | null
  interest_only: string | null
  rate_locked_days: string | null
  rate_lock_expiration_date: string | null
  rate_lock_extended: string | null
  origination_date: string | null
  maturity_date: string | null
  entity_name: string | null
  estimated_closing_date: string | null

  // ---- Loan / Deal Overview (loan_details) ----
  submitted_at: string | null
  funded_date: string | null
  urgency: string | null
  investor: string | null
  cross_collateralization: boolean | null
  foreign_national: boolean | null

  // ---- Property ----
  property_state: string | null
  property_type: string | null
  number_of_units: number | null
  flood_zone: string | null
  square_footage: number | null

  // ---- Loan Terms (loan_details) ----
  loan_type_one: string | null            // "Loan Purpose"
  initial_loan_amount: number | null
  cash_out_amount: number | null
  rate_type: string | null
  points: number | null
  broker_points: number | null
  broker_ysp: number | null
  amortization_schedule: string | null
  prepayment_penalty: string | null
  first_payment_date: string | null

  // ---- Fees ----
  underwriting_fee: number | null
  legal_doc_prep_fee: number | null
  desk_review_fee: number | null
  small_balance_fee: number | null
  feasibility_fee: number | null
  additional_fees: number | null

  // ---- Valuation / Collateral ----
  purchase_price: number | null
  acquisition_date: string | null
  value_as_is: number | null
  value_bpo: number | null

  // ---- Construction / DSCR inputs ----
  construction_holdback: number | null
  qualifying_rent: number | null
  annual_property_tax: number | null
  annual_insurance_premium: number | null
  annual_flood_insurance: number | null
  annual_hoa_dues: number | null

  // ---- Borrower / Credit ----
  number_of_properties: number | null
  verified_assets: string | null
  credit_score: number | null
  credit_report_date: string | null

  // ---- Appraisal ----
  appraisal_order_date: string | null
  appraisal_paid_date: string | null
  appraisal_received_date: string | null
  appraisal_effective_date: string | null

  // ---- Vendors ----
  title_company: string | null
  insurance_company: string | null
  appraisal_company: string | null

  // ---- UW notes / exceptions ----
  exceptions: string | null
  underwriter_notes: string | null
}

export interface DataTapeResult {
  rows: DataTapeRow[]
  /** Total matching loans in the DB, even if we capped the returned
   *  rows. Drives the "Showing N of M" banner in the UI. */
  totalMatching: number
  /** True when the result was clipped at DATA_TAPE_MAX_ROWS. */
  capped: boolean
  /** Set when the query itself errored — the page still renders the
   *  empty-state shell instead of a 500. */
  errorMessage: string | null
}

export async function fetchDataTape(adminClient: SupabaseClient): Promise<DataTapeResult> {
  try {
    // Headcount query — small and cheap, so we know whether to flag
    // the capped state in the UI.
    const { count } = await adminClient
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('archived', false)
      .neq('pipeline_stage', 'New Application')
      .not('pipeline_stage', 'is', null)
      // SQL 3-value logic: `loan_status <> 'on_hold'` is NULL (not
      // TRUE) when loan_status IS NULL, so a plain .neq() would
      // exclude rows with a NULL status. The OR clause keeps those
      // (NULL means "active" by convention) while still excluding
      // explicit on_hold rows.
      .or('loan_status.is.null,loan_status.neq.on_hold')

    const totalMatching = count ?? 0

    // Main fetch — single round trip with nested role-staff names and
    // the full loan_details row. .range() pulls the most recent
    // DATA_TAPE_MAX_ROWS so the response stays under Vercel's size
    // ceiling. Closed loans come back in this set too (they're not
    // archived yet) so the UI's stage filter handles "active only"
    // toggling.
    const { data, error } = await adminClient
      .from('loans')
      .select(`
        id, property_address, loan_number, pipeline_stage, loan_status,
        loan_type, loan_amount, interest_rate, ltv, arv, rehab_budget,
        term_months, interest_only, rate_locked_days, rate_lock_expiration_date,
        rate_lock_extended, origination_date, maturity_date, entity_name,
        estimated_closing_date,
        borrowers!borrower_id ( full_name ),
        brokers!broker_id ( full_name, company_name ),
        loan_officers!loan_officer_id ( full_name ),
        loan_processors!loan_processor_id ( full_name ),
        underwriters!underwriter_id ( full_name ),
        loan_details (
          investor_loan_number, min_number, submitted_at, funded_date,
          urgency, investor, cross_collateralization, foreign_national,
          property_state, property_type, number_of_units, flood_zone,
          square_footage,
          loan_type_one, initial_loan_amount, cash_out_amount,
          rate_type, points, broker_points, broker_ysp,
          amortization_schedule, prepayment_penalty, first_payment_date,
          underwriting_fee, legal_doc_prep_fee, desk_review_fee,
          small_balance_fee, feasibility_fee, additional_fees,
          purchase_price, acquisition_date, value_as_is, value_bpo,
          construction_holdback, qualifying_rent,
          annual_property_tax, annual_insurance_premium,
          annual_flood_insurance, annual_hoa_dues,
          number_of_properties, verified_assets,
          credit_score, credit_report_date,
          appraisal_order_date, appraisal_paid_date, appraisal_received_date, appraisal_effective_date,
          title_company, insurance_company, appraisal_company,
          exceptions, underwriter_notes
        )
      `)
      .eq('archived', false)
      .neq('pipeline_stage', 'New Application')
      .not('pipeline_stage', 'is', null)
      // SQL 3-value logic: `loan_status <> 'on_hold'` is NULL (not
      // TRUE) when loan_status IS NULL, so a plain .neq() would
      // exclude rows with a NULL status. The OR clause keeps those
      // (NULL means "active" by convention) while still excluding
      // explicit on_hold rows.
      .or('loan_status.is.null,loan_status.neq.on_hold')
      .order('created_at', { ascending: false })
      .range(0, DATA_TAPE_MAX_ROWS - 1)

    if (error) {
      console.error('fetchDataTape query error:', error)
      return { rows: [], totalMatching, capped: false, errorMessage: error.message }
    }

    // Per-row try/catch so a single malformed loan can't take down the
    // whole tape. Bad rows are skipped + logged; the rest still render.
    const rows: DataTapeRow[] = []
    for (const raw of data ?? []) {
      try {
        rows.push(flatten(raw))
      } catch (err) {
        const id = (raw as { id?: unknown })?.id
        console.error(`flatten failed for loan ${String(id ?? 'unknown')}:`, err)
      }
    }
    return {
      rows,
      totalMatching,
      capped: totalMatching > rows.length,
      errorMessage: null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('fetchDataTape failed:', msg)
    return { rows: [], totalMatching: 0, capped: false, errorMessage: msg }
  }
}

interface RawLoan {
  id: string
  property_address: string | null
  loan_number: string | null
  pipeline_stage: string | null
  loan_status: string | null
  loan_type: string | null
  loan_amount: number | null
  interest_rate: number | null
  ltv: number | null
  arv: number | null
  rehab_budget: number | null
  term_months: number | null
  interest_only: string | null
  rate_locked_days: string | null
  rate_lock_expiration_date: string | null
  rate_lock_extended: string | null
  origination_date: string | null
  maturity_date: string | null
  entity_name: string | null
  estimated_closing_date: string | null
  borrowers?: { full_name: string | null } | null
  brokers?: { full_name: string | null; company_name: string | null } | null
  loan_officers?: { full_name: string | null } | null
  loan_processors?: { full_name: string | null } | null
  underwriters?: { full_name: string | null } | null
  loan_details?: Partial<Record<string, unknown>> | Array<Partial<Record<string, unknown>>> | null
}

function flatten(raw: unknown): DataTapeRow {
  const r = raw as RawLoan
  const details = (Array.isArray(r.loan_details) ? r.loan_details[0] : r.loan_details) ?? {}

  // Helper — Supabase returns string/number values typed loosely, so
  // we coerce at the boundary instead of sprinkling `as` casts in
  // the table component.
  const s = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v))
  const n = (v: unknown): number | null => (typeof v === 'number' ? v : v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null)
  const b = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : v == null ? null : null)

  return {
    id: r.id,
    property_address: r.property_address,
    loan_number: r.loan_number,
    investor_loan_number: s(details.investor_loan_number),
    min_number: s(details.min_number),
    pipeline_stage: r.pipeline_stage,
    loan_status: r.loan_status,

    borrower_name: r.borrowers?.full_name ?? null,
    loan_officer_name: r.loan_officers?.full_name ?? null,
    loan_processor_name: r.loan_processors?.full_name ?? null,
    underwriter_name: r.underwriters?.full_name ?? null,
    broker_name: r.brokers?.full_name ?? null,
    broker_company: r.brokers?.company_name ?? null,

    loan_type: r.loan_type,
    loan_amount: r.loan_amount,
    interest_rate: r.interest_rate,
    ltv: r.ltv,
    arv: r.arv,
    rehab_budget: r.rehab_budget,
    term_months: r.term_months,
    interest_only: r.interest_only,
    rate_locked_days: r.rate_locked_days,
    rate_lock_expiration_date: r.rate_lock_expiration_date,
    rate_lock_extended: r.rate_lock_extended,
    origination_date: r.origination_date,
    maturity_date: r.maturity_date,
    entity_name: r.entity_name,
    estimated_closing_date: r.estimated_closing_date,

    submitted_at: s(details.submitted_at),
    funded_date: s(details.funded_date),
    urgency: s(details.urgency),
    investor: s(details.investor),
    cross_collateralization: b(details.cross_collateralization),
    foreign_national: b(details.foreign_national),

    property_state: s(details.property_state),
    property_type: s(details.property_type),
    number_of_units: n(details.number_of_units),
    flood_zone: s(details.flood_zone),
    square_footage: n(details.square_footage),

    loan_type_one: s(details.loan_type_one),
    initial_loan_amount: n(details.initial_loan_amount),
    cash_out_amount: n(details.cash_out_amount),
    rate_type: s(details.rate_type),
    points: n(details.points),
    broker_points: n(details.broker_points),
    broker_ysp: n(details.broker_ysp),
    amortization_schedule: s(details.amortization_schedule),
    prepayment_penalty: s(details.prepayment_penalty),
    first_payment_date: s(details.first_payment_date),

    underwriting_fee: n(details.underwriting_fee),
    legal_doc_prep_fee: n(details.legal_doc_prep_fee),
    desk_review_fee: n(details.desk_review_fee),
    small_balance_fee: n(details.small_balance_fee),
    feasibility_fee: n(details.feasibility_fee),
    additional_fees: n(details.additional_fees),

    purchase_price: n(details.purchase_price),
    acquisition_date: s(details.acquisition_date),
    value_as_is: n(details.value_as_is),
    value_bpo: n(details.value_bpo),

    construction_holdback: n(details.construction_holdback),
    qualifying_rent: n(details.qualifying_rent),
    annual_property_tax: n(details.annual_property_tax),
    annual_insurance_premium: n(details.annual_insurance_premium),
    annual_flood_insurance: n(details.annual_flood_insurance),
    annual_hoa_dues: n(details.annual_hoa_dues),

    number_of_properties: n(details.number_of_properties),
    verified_assets: s(details.verified_assets),
    credit_score: n(details.credit_score),
    credit_report_date: s(details.credit_report_date),

    appraisal_order_date: s(details.appraisal_order_date),
    appraisal_paid_date: s(details.appraisal_paid_date),
    appraisal_received_date: s(details.appraisal_received_date),
    appraisal_effective_date: s(details.appraisal_effective_date),

    title_company: s(details.title_company),
    insurance_company: s(details.insurance_company),
    appraisal_company: s(details.appraisal_company),

    exceptions: s(details.exceptions),
    underwriter_notes: s(details.underwriter_notes),
  }
}
