import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { updateDealField } from '@/lib/pipedrive'
import { PORTAL_URL } from '@/lib/portal-url'
import { sendEmail } from '@/lib/mailer'
import { sendRateLockedEmail } from '@/lib/expiration-emails'

/**
 * Convert a rate_locked_days enum value ("No" / "15 days" / "30 days"
 * / "45 days") to its numeric days. Returns null for "No" / unknown so
 * the rate-locked notification only fires on a real lock.
 */
function parseLockDays(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = /^(\d+)\s*days?/i.exec(v.trim())
  return m ? Number(m[1]) : null
}
import {
  PIPEDRIVE_FIELDS,
  PIPEDRIVE_LOAN_TYPE_MAP,
  type LoanType,
} from '@/lib/types'

type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'enum' | 'boolean'
type Table = 'loans' | 'loan_details'

interface FieldConfig {
  type: FieldType
  /** Defaults to 'loans'. loan_details fields skip Pipedrive sync. */
  table?: Table
  /** Pipedrive custom-field key. Required for table='loans', omitted for loan_details. */
  pdKey?: string
  /** For enum fields: map of canonical value → Pipedrive option ID.
   *  Use `null` for values that should CLEAR the Pipedrive field (e.g. a
   *  yes-only enum where the portal's "No" means "not set"). */
  optionMap?: Record<string, number | null>
  /** For enum fields: list of valid values */
  validValues?: readonly string[]
}

// Loan-type name → option ID (inverse of PIPEDRIVE_LOAN_TYPE_MAP)
const LOAN_TYPE_OPTION_MAP: Record<string, number> = Object.entries(PIPEDRIVE_LOAN_TYPE_MAP)
  .reduce((acc, [id, name]) => {
    acc[name] = Number(id)
    return acc
  }, {} as Record<string, number>)

const LOAN_TYPES: LoanType[] = ['Fix & Flip (Bridge)', 'Rental (DSCR)', 'New Construction']

// Pipedrive option IDs for the "Interest Only" Yes/No enum (key f0b4...4920fc3).
const INTEREST_ONLY_OPTIONS = ['Yes', 'No'] as const
const INTEREST_ONLY_OPTION_MAP: Record<string, number | null> = { Yes: 269, No: 270 }

// Rate Lock Extended is portal + Airtable only (no Pipedrive equivalent).
// Stored as text on loans to mirror Airtable's "Yes" / "No" singleSelect
// directly — no transform needed.
const RATE_LOCK_EXTENDED_OPTIONS = ['Yes', 'No'] as const

// Funding Source — portal + Airtable only (no Pipedrive equivalent).
// Mirrors Airtable's "Funding Source" singleSelect ('In House' / 'RAI')
// directly, so it passes through with no transform.
const FUNDING_SOURCE_OPTIONS = ['In House', 'RAI'] as const

// "Locked?" is a Pipedrive yes-only enum (only one option id: 148 = "Yes").
// Portal stores granularity (No / 15 / 30 / 45 days). Push "Yes" for any
// locked value, null when "No" — and avoid clobbering on pull (see
// src/lib/pipedrive.ts).
const RATE_LOCK_OPTIONS = ['No', '15 days', '30 days', '45 days'] as const
const RATE_LOCK_OPTION_MAP: Record<string, number | null> = {
  'No': null,
  '15 days': 148,
  '30 days': 148,
  '45 days': 148,
}

const URGENCY_OPTIONS = ['Low', 'Medium', 'High', 'Urgent'] as const
const INVESTOR_OPTIONS = [
  'Toorak', 'Churchill', 'Eastview', 'Silver', 'Blue', 'FE',
  'ROC', 'Corvest', 'Held', 'Logan Financial', 'DSCR', 'Verus',
] as const
const RATE_TYPE_OPTIONS = ['Fixed', 'ARM'] as const
const PROPERTY_TYPE_OPTIONS = ['SFR', '2-4 Unit', 'Multifamily', 'Condo', 'Townhouse', 'Mixed Use', 'Commercial'] as const
const AMORTIZATION_OPTIONS = ['Interest Only', '15-yr', '20-yr', '25-yr', '30-yr', '40-yr'] as const
const LOAN_TYPE_ONE_OPTIONS = ['Purchase', 'Refinance (no cash out)', 'Refinance (cash out)', 'Delayed Purchase'] as const
const OWN_OR_RENT_OPTIONS = ['Own', 'Rent'] as const
const ENTITY_TYPE_OPTIONS = ['LLC', 'Inc', 'Trust', 'LP'] as const

const FIELD_WHITELIST: Record<string, FieldConfig> = {
  // ===== loans table (synced to Pipedrive) =====
  loan_number:      { type: 'text',   pdKey: PIPEDRIVE_FIELDS.loanNumber },
  loan_type:        { type: 'enum',   pdKey: PIPEDRIVE_FIELDS.loanType, optionMap: LOAN_TYPE_OPTION_MAP, validValues: LOAN_TYPES },
  loan_amount:      { type: 'number', pdKey: 'value' }, // Pipedrive default deal value field
  interest_rate:    { type: 'number', pdKey: PIPEDRIVE_FIELDS.interestRate },
  ltv:              { type: 'number', pdKey: PIPEDRIVE_FIELDS.ltv },
  arv:              { type: 'number', pdKey: PIPEDRIVE_FIELDS.arv },
  rehab_budget:     { type: 'number', pdKey: PIPEDRIVE_FIELDS.rehabBudget },
  term_months:      { type: 'number', pdKey: PIPEDRIVE_FIELDS.termMonths },
  origination_date: { type: 'date',   pdKey: PIPEDRIVE_FIELDS.originationDate },
  maturity_date:    { type: 'date',   pdKey: PIPEDRIVE_FIELDS.maturityDate },
  entity_name:      { type: 'text',   pdKey: PIPEDRIVE_FIELDS.entityName },
  interest_only:    { type: 'enum',   pdKey: PIPEDRIVE_FIELDS.interestOnly, optionMap: INTEREST_ONLY_OPTION_MAP, validValues: INTEREST_ONLY_OPTIONS },
  rate_locked_days: { type: 'enum',   pdKey: PIPEDRIVE_FIELDS.rateLocked,   optionMap: RATE_LOCK_OPTION_MAP,     validValues: RATE_LOCK_OPTIONS },
  rate_lock_expiration_date: { type: 'date', pdKey: PIPEDRIVE_FIELDS.rateLockExpiration },
  // Portal + Airtable only — no Pipedrive sync, so no pdKey. Field
  // route still writes to the loans table; the Airtable cron picks
  // it up via the FIELD_MAP entry in airtable-field-map.ts.
  rate_lock_date:     { type: 'date' },
  rate_lock_extended: { type: 'enum',   validValues: RATE_LOCK_EXTENDED_OPTIONS },
  funding_source:     { type: 'enum',   validValues: FUNDING_SOURCE_OPTIONS },

  // ===== loan_details table (portal-only, no Pipedrive sync) =====
  // Loan / Deal Overview
  investor_loan_number:    { type: 'text',     table: 'loan_details' },
  min_number:              { type: 'text',     table: 'loan_details' },
  funded_date:             { type: 'date',     table: 'loan_details' },
  loan_application:        { type: 'text',     table: 'loan_details' },
  submitted_at:            { type: 'date',     table: 'loan_details' },
  urgency:                 { type: 'enum',     table: 'loan_details', validValues: URGENCY_OPTIONS },
  investor:                { type: 'enum',     table: 'loan_details', validValues: INVESTOR_OPTIONS },
  reason_canceled:         { type: 'textarea', table: 'loan_details' },
  underwriter_notes:       { type: 'textarea', table: 'loan_details' },
  exceptions:              { type: 'textarea', table: 'loan_details' },
  cross_collateralization: { type: 'boolean',  table: 'loan_details' },
  foreign_national:        { type: 'boolean',  table: 'loan_details' },

  // Property Information
  property_street:    { type: 'text',   table: 'loan_details' },
  property_city:      { type: 'text',   table: 'loan_details' },
  property_state:     { type: 'text',   table: 'loan_details' },
  property_zip:       { type: 'text',   table: 'loan_details' },
  property_type:      { type: 'enum',   table: 'loan_details', validValues: PROPERTY_TYPE_OPTIONS },
  number_of_units:    { type: 'number', table: 'loan_details' },
  flood_zone:         { type: 'text',   table: 'loan_details' },

  // Loan Terms
  initial_loan_amount:    { type: 'number',   table: 'loan_details' },
  cash_out_amount:        { type: 'number',   table: 'loan_details' },
  rate_type:              { type: 'enum',     table: 'loan_details', validValues: RATE_TYPE_OPTIONS },
  points:                 { type: 'number',   table: 'loan_details' },
  broker_points:          { type: 'number',   table: 'loan_details' },
  broker_ysp:             { type: 'number',   table: 'loan_details' },
  rate_costs_points:            { type: 'number', table: 'loan_details' },
  other_exception_costs_points: { type: 'number', table: 'loan_details' },
  // New fee fields. Desk Review + Small Balance are Airtable formula
  // fields (pull-only via the read-only-type guard); Feasibility Fee +
  // Additional Fees are bidirectional. additional_fees_notes is
  // portal-only freeform — captures which fees were rolled into the
  // Additional Fees total (Flood Cert, COGS, Credit Rescore, Other).
  desk_review_fee:        { type: 'number',   table: 'loan_details' },
  small_balance_fee:      { type: 'number',   table: 'loan_details' },
  feasibility_fee:        { type: 'number',   table: 'loan_details' },
  additional_fees:        { type: 'number',   table: 'loan_details' },
  additional_fees_notes:  { type: 'textarea', table: 'loan_details' },
  underwriting_fee:       { type: 'number',   table: 'loan_details' },
  legal_doc_prep_fee:     { type: 'number',   table: 'loan_details' },
  prepayment_penalty:     { type: 'text',     table: 'loan_details' },
  amortization_schedule:  { type: 'enum',     table: 'loan_details', validValues: AMORTIZATION_OPTIONS },
  first_payment_date:     { type: 'date',     table: 'loan_details' },

  // Borrower / Guarantor
  coborrower_name:        { type: 'text',     table: 'loan_details' },
  coborrower_phone:       { type: 'text',     table: 'loan_details' },
  coborrower_email:       { type: 'text',     table: 'loan_details' },
  experience_borrower:    { type: 'text',     table: 'loan_details' },
  experience_coborrower:  { type: 'text',     table: 'loan_details' },
  experience_notes:       { type: 'textarea', table: 'loan_details' },
  number_of_properties:   { type: 'number',   table: 'loan_details' },
  verified_assets:        { type: 'text',     table: 'loan_details' },

  // Credit / Background
  credit_report_date:        { type: 'date',     table: 'loan_details' },
  credit_score:              { type: 'number',   table: 'loan_details' },
  background_check_date:     { type: 'date',     table: 'loan_details' },
  credit_background_notes:   { type: 'textarea', table: 'loan_details' },

  // Appraisal / Review Tracking
  appraisal_order_date:     { type: 'date', table: 'loan_details' },
  appraisal_due_date:       { type: 'date', table: 'loan_details' },
  appraisal_received_date:  { type: 'date', table: 'loan_details' },
  appraisal_effective_date: { type: 'date', table: 'loan_details' },
  appraisal_paid_date:      { type: 'date', table: 'loan_details' },

  // Valuation / Collateral
  purchase_price:    { type: 'number', table: 'loan_details' },
  acquisition_date:  { type: 'date',   table: 'loan_details' },
  value_as_is:       { type: 'number', table: 'loan_details' },
  value_bpo:         { type: 'number', table: 'loan_details' },
  payoff:            { type: 'number', table: 'loan_details' },

  // Construction / Rehab
  construction_holdback: { type: 'number', table: 'loan_details' },
  draw_fee:              { type: 'number', table: 'loan_details' },
  interest_reserve:      { type: 'number', table: 'loan_details' },

  // DSCR inputs
  qualifying_rent:           { type: 'number', table: 'loan_details' },
  annual_insurance_premium:  { type: 'number', table: 'loan_details' },
  annual_property_tax:       { type: 'number', table: 'loan_details' },
  annual_flood_insurance:    { type: 'number', table: 'loan_details' },
  annual_hoa_dues:           { type: 'number', table: 'loan_details' },

  // ===== JotForm-sourced columns added with the application intake =====
  // Property Information additions
  square_footage: { type: 'number',  table: 'loan_details' },
  units_vacant:   { type: 'boolean', table: 'loan_details' },

  // Loan Terms — Loan Purpose (Purchase / Refi variants; column is
  // historically named loan_type_one)
  loan_type_one: { type: 'enum', table: 'loan_details', validValues: LOAN_TYPE_ONE_OPTIONS },

  // Borrower / Guarantor — financial summary
  liquid_assets_total: { type: 'number', table: 'loan_details' },

  // Credit / Background — self-reported (separate from real pulled score)
  credit_score_estimate: { type: 'number',  table: 'loan_details' },
  credit_frozen:         { type: 'boolean', table: 'loan_details' },

  // Application Profile (borrower-side flags from the loan application)
  own_or_rent:           { type: 'enum',    table: 'loan_details', validValues: OWN_OR_RENT_OPTIONS },
  mortgage_on_primary:   { type: 'boolean', table: 'loan_details' },
  intent_to_occupy:      { type: 'boolean', table: 'loan_details' },
  down_payment_borrowed: { type: 'boolean', table: 'loan_details' },

  // Title, Insurance, Appraiser contact info
  title_company:           { type: 'text', table: 'loan_details' },
  title_contact_name:      { type: 'text', table: 'loan_details' },
  title_email:             { type: 'text', table: 'loan_details' },
  title_phone:             { type: 'text', table: 'loan_details' },
  insurance_company:       { type: 'text', table: 'loan_details' },
  insurance_contact_name:  { type: 'text', table: 'loan_details' },
  insurance_email:         { type: 'text', table: 'loan_details' },
  insurance_phone:         { type: 'text', table: 'loan_details' },
  appraisal_company:       { type: 'text', table: 'loan_details' },
  appraisal_contact_name:  { type: 'text', table: 'loan_details' },
  appraisal_email:         { type: 'text', table: 'loan_details' },
  appraisal_phone:         { type: 'text', table: 'loan_details' },

  // Vesting Entity (entity_name itself stays on loans table — it syncs to Pipedrive)
  vesting_in_entity:      { type: 'boolean', table: 'loan_details' },
  entity_type:            { type: 'enum',    table: 'loan_details', validValues: ENTITY_TYPE_OPTIONS },
  entity_formation_state: { type: 'text',    table: 'loan_details' },
}

/**
 * When an LP/LO/UW sets the Appraisal Received Date on a loan, automatically
 * add the "Appraisal Received" condition (LO action: review appraisal +
 * update sizer) if it isn't already on the loan. The condition title +
 * description + assigned_to are sourced from condition_templates so changes
 * to the template flow through.
 *
 * No-op if:
 *   - the template doesn't exist
 *   - a condition with the same title already exists on this loan
 */
async function maybeAutoAddAppraisalCondition(
  adminClient: ReturnType<typeof createAdminClient>,
  loanId: string,
  editorName: string | null,
) {
  try {
    const TITLE = 'Appraisal Received'

    const { data: existing } = await adminClient
      .from('conditions').select('id')
      .eq('loan_id', loanId).eq('title', TITLE).maybeSingle()
    if (existing) return  // already on the loan

    const { data: template } = await adminClient
      .from('condition_templates')
      .select('title, description, assigned_to, category')
      .eq('title', TITLE).maybeSingle()
    if (!template) return  // template missing — bail silently

    await adminClient.from('conditions').insert({
      loan_id: loanId,
      title: template.title,
      description: template.description,
      assigned_to: template.assigned_to,
      category: template.category,
      status: 'Outstanding',
    })

    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'condition_added',
      description: `Condition automatically added (Loan Officer): "${TITLE}" — triggered by Appraisal Received Date being set${editorName ? ` by ${editorName}` : ''}`,
    })

    // Notify the assigned LO via email (matches the manual condition-add
    // flow in /api/loan-processor/conditions etc.)
    if (template.assigned_to === 'loan_officer') {
      try {
        const { data: loan } = await adminClient
          .from('loans')
          .select('property_address, loan_officers(full_name, email)')
          .eq('id', loanId).single()
        const lo = loan?.loan_officers as unknown as { full_name: string | null; email: string | null } | null
        if (lo?.email) {
          const addr = loan?.property_address ?? 'a loan'
          const conditionHtml =
            `<tr><td style="padding:4px 16px 4px 0;color:#666;">Condition</td><td><strong>${template.title}</strong></td></tr>` +
            (template.description
              ? `<tr><td style="padding:4px 16px 4px 0;color:#666;">Details</td><td>${template.description}</td></tr>`
              : '')
          const html =
            `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${lo.full_name ?? 'there'},</p>` +
            `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">A new condition has been assigned to you for <strong>${addr}</strong>.</p>` +
            `<table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">${conditionHtml}</table>` +
            `<p style="margin-top:16px;"><a href="${PORTAL_URL}/loan-officer" style="background-color:#1F5D8F;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">View in Portal</a></p>` +
            `<p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">First Equity Funding Online Portal</p>`
          await sendEmail({
            to: lo.email,
            subject: `New condition assigned to you — ${addr}`,
            html,
          })
        }
      } catch (mailErr) {
        console.error('Auto Appraisal Received email failed:', mailErr instanceof Error ? mailErr.message : mailErr)
      }
    }
  } catch (err) {
    // Don't fail the parent field-update API call if the automation hiccups.
    console.error('Auto-add Appraisal Received condition failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Compute the DSCR LTV (loan_amount / value_as_is, as percent) for the given
 * loan. Returns null if value_as_is is missing/zero so the caller can skip.
 */
async function computeDscrLtv(
  adminClient: ReturnType<typeof createAdminClient>,
  loanId: string,
  loanAmount: number,
): Promise<number | null> {
  const { data: d } = await adminClient
    .from('loan_details').select('value_as_is').eq('loan_id', loanId).maybeSingle()
  const v = d?.value_as_is
  if (!v || v <= 0 || !loanAmount || loanAmount <= 0) return null
  return Math.round((Number(loanAmount) / Number(v)) * 100 * 100) / 100
}

export async function PATCH(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name, is_ops_manager').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])

  if (!admin && !lo && !lp && !uw) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, field, value } = await req.json()
  if (!loanId || !field) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const config = FIELD_WHITELIST[field]
  if (!config) return NextResponse.json({ error: `Field "${field}" is not editable` }, { status: 400 })

  const table: Table = config.table ?? 'loans'

  // Coerce + validate value
  let dbValue: string | number | boolean | null = null  // Goes to local DB
  let pdValue: string | number | null = null            // Goes to Pipedrive (only for table='loans')

  if (value === null || value === '' || value === undefined) {
    dbValue = null
    pdValue = null
  } else if (config.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (isNaN(n)) return NextResponse.json({ error: 'Invalid number' }, { status: 400 })
    dbValue = n
    pdValue = n
  } else if (config.type === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return NextResponse.json({ error: 'Date must be YYYY-MM-DD' }, { status: 400 })
    }
    dbValue = value
    pdValue = value
  } else if (config.type === 'enum') {
    if (typeof value !== 'string') return NextResponse.json({ error: 'Invalid enum value' }, { status: 400 })
    if (config.validValues && !config.validValues.includes(value)) {
      return NextResponse.json({ error: `Invalid value for ${field}` }, { status: 400 })
    }
    dbValue = value
    // Only require a Pipedrive option mapping when the field actually
    // syncs to Pipedrive. Portal-only loans-table enums (e.g.
    // rate_lock_extended, which syncs with Airtable but not Pipedrive)
    // have no pdKey and no optionMap — skip the Pipedrive value resolution
    // entirely; the write path below already gates on config.pdKey.
    if (table === 'loans' && config.pdKey) {
      const optionId = config.optionMap?.[value]
      if (optionId === undefined) return NextResponse.json({ error: `No Pipedrive option mapped for "${value}"` }, { status: 500 })
      pdValue = optionId
    }
  } else if (config.type === 'boolean') {
    dbValue = Boolean(value)
  } else {
    // text or textarea
    if (typeof value !== 'string') return NextResponse.json({ error: 'Invalid text value' }, { status: 400 })
    dbValue = value.trim() || null
    pdValue = value.trim() || null
  }

  // Get loan + verify access. rate_locked_days is fetched alongside the
  // access columns so we can detect a "No → 15/30/45 days" transition
  // and fire the rate-locked notification email after the update lands.
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, pipedrive_deal_id, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id, rate_locked_days')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  if (!admin) {
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (lp.is_ops_manager || loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Editor display name — used by both the audit log and any automation
  // triggers below (e.g. the Appraisal Received auto-condition).
  const editorName: string | null =
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    (admin ? 'Admin' : null)

  // Pipedrive write — only for loans-table fields with a pdKey
  if (table === 'loans' && config.pdKey) {
    if (!loan.pipedrive_deal_id) {
      return NextResponse.json({ error: 'Loan has no Pipedrive deal id' }, { status: 400 })
    }
    try {
      await updateDealField(loan.pipedrive_deal_id, config.pdKey, pdValue)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipedrive update failed'
      console.error('updateDealField failed:', msg)
      return NextResponse.json({ error: `Could not update Pipedrive: ${msg}` }, { status: 502 })
    }
  }

  // Mirror locally
  if (table === 'loans') {
    const patch: Record<string, unknown> = { [field]: dbValue }

    // DSCR-specific defaults: when an LO/admin flips loan_type to
    // 'Rental (DSCR)', pre-fill term_months = 360 and interest_only = 'No'
    // for any of those fields that are currently null. DSCR rentals are
    // consistently amortizing 30-year so this saves manual entry. Manual
    // edits via the same API afterwards still work normally.
    if (field === 'loan_type' && dbValue === 'Rental (DSCR)') {
      const { data: current } = await adminClient
        .from('loans').select('term_months, interest_only, loan_amount').eq('id', loanId).single()
      if (current?.term_months == null) patch.term_months = 360
      if (current?.interest_only == null) patch.interest_only = 'No'
      // Also recompute LTV if both inputs exist (loan just became DSCR).
      if (current?.loan_amount) {
        const computed = await computeDscrLtv(adminClient, loanId, current.loan_amount as number)
        if (computed != null) patch.ltv = computed
      }
    }

    // Amortization Schedule default based on loan_type. Lives on loan_details
    // (separate upsert from the loans-table patch). Only fills the field if
    // it's currently null so manual selections aren't clobbered.
    if (field === 'loan_type') {
      const defaultAmort =
        dbValue === 'Rental (DSCR)' ? '30-yr' :
        (dbValue === 'Fix & Flip (Bridge)' || dbValue === 'New Construction') ? 'Interest Only' :
        null
      if (defaultAmort) {
        const { data: existing } = await adminClient
          .from('loan_details').select('amortization_schedule').eq('loan_id', loanId).maybeSingle()
        if (!existing?.amortization_schedule) {
          await adminClient.from('loan_details').upsert(
            { loan_id: loanId, amortization_schedule: defaultAmort, updated_at: new Date().toISOString() },
            { onConflict: 'loan_id' },
          )
        }
      }
    }

    // DSCR LTV auto-calc when the loan_amount changes on a DSCR loan.
    if (field === 'loan_amount' && typeof dbValue === 'number') {
      const { data: l } = await adminClient
        .from('loans').select('loan_type').eq('id', loanId).single()
      if (l?.loan_type === 'Rental (DSCR)') {
        const computed = await computeDscrLtv(adminClient, loanId, dbValue)
        if (computed != null) patch.ltv = computed
      }
    }

    const { error } = await adminClient
      .from('loans')
      .update(patch)
      .eq('id', loanId)
    if (error) {
      console.error('Local field update failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Mirror LTV change to Pipedrive when we recomputed it (we already
    // wrote the primary field above; this ensures Pipedrive's LTV stays
    // aligned with the portal's auto-calc).
    if (patch.ltv != null && field !== 'ltv' && loan.pipedrive_deal_id) {
      try {
        await updateDealField(loan.pipedrive_deal_id, PIPEDRIVE_FIELDS.ltv, patch.ltv as number)
      } catch (err) {
        console.error('LTV Pipedrive push failed:', err instanceof Error ? err.message : err)
      }
    }

    // "Rate just got locked" notification — fires when rate_locked_days
    // flips from null / 'No' to a numeric option (15/30/45 days). Emails
    // LO + LP(s) with the lock window and the resulting expiration date.
    // Fire-and-forget; the field update already succeeded.
    if (field === 'rate_locked_days') {
      const prev = (loan as unknown as { rate_locked_days: string | null }).rate_locked_days
      const wasUnlocked = !prev || prev === 'No'
      const days = parseLockDays(dbValue)
      if (wasUnlocked && days !== null) {
        try {
          await sendRateLockedEmail(loanId, days)
        } catch (err) {
          console.error('sendRateLockedEmail failed:', err)
        }
      }
    }
  } else {
    // loan_details — upsert by loan_id (the migration backfilled rows, but be defensive)
    const { error } = await adminClient
      .from('loan_details')
      .upsert(
        { loan_id: loanId, [field]: dbValue, updated_at: new Date().toISOString() },
        { onConflict: 'loan_id' },
      )
    if (error) {
      console.error('loan_details update failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // DSCR LTV auto-calc when value_as_is changes on a DSCR loan.
    if (field === 'value_as_is' && typeof dbValue === 'number') {
      const { data: l } = await adminClient
        .from('loans').select('loan_type, loan_amount, pipedrive_deal_id').eq('id', loanId).single()
      if (l?.loan_type === 'Rental (DSCR)' && l.loan_amount) {
        const newLtv = Math.round((Number(l.loan_amount) / dbValue) * 100 * 100) / 100
        await adminClient.from('loans').update({ ltv: newLtv }).eq('id', loanId)
        if (l.pipedrive_deal_id) {
          try { await updateDealField(l.pipedrive_deal_id, PIPEDRIVE_FIELDS.ltv, newLtv) }
          catch (err) { console.error('LTV Pipedrive push failed:', err instanceof Error ? err.message : err) }
        }
      }
    }

    // Auto-create the "Appraisal Received" condition (LO action item) when
    // the Appraisal Received Date is set on a loan that doesn't already have
    // this condition. Uses the existing condition_templates row as the
    // source of truth for title / description / assignment.
    if (field === 'appraisal_received_date' && typeof dbValue === 'string' && dbValue.trim()) {
      await maybeAutoAddAppraisalCondition(adminClient, loanId, editorName)
    }
  }

  // Audit log (editorName computed above for use across this handler)
  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'field_updated',
      description: `${field} set to ${dbValue ?? '—'}${editorName ? ` by ${editorName}` : ''}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
