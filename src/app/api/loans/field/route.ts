import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateDealField } from '@/lib/pipedrive'
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
  /** For enum fields: map of canonical value → Pipedrive option ID */
  optionMap?: Record<string, number>
  /** For enum fields: list of valid values */
  validValues?: readonly string[]
}

// Loan-type name → option ID (inverse of PIPEDRIVE_LOAN_TYPE_MAP)
const LOAN_TYPE_OPTION_MAP: Record<string, number> = Object.entries(PIPEDRIVE_LOAN_TYPE_MAP)
  .reduce((acc, [id, name]) => {
    acc[name] = Number(id)
    return acc
  }, {} as Record<string, number>)

const LOAN_TYPES: LoanType[] = ['Bridge', 'Fix & Flip', 'New Construction', 'DSCR']

const URGENCY_OPTIONS = ['Low', 'Medium', 'High', 'Urgent'] as const
const RATE_TYPE_OPTIONS = ['Fixed', 'ARM'] as const
const PROPERTY_TYPE_OPTIONS = ['SFR', '2-4 Unit', 'Multifamily', 'Condo', 'Townhouse', 'Mixed Use', 'Commercial'] as const
const AMORTIZATION_OPTIONS = ['Interest Only', '15-yr', '20-yr', '25-yr', '30-yr'] as const
const LOAN_TYPE_ONE_OPTIONS = ['Purchase', 'Refinance (no cash out)', 'Refinance (cash out)', 'Delayed Purchase'] as const
const OWN_OR_RENT_OPTIONS = ['Own', 'Rent'] as const
const ENTITY_TYPE_OPTIONS = ['LLC', 'Inc'] as const

const FIELD_WHITELIST: Record<string, FieldConfig> = {
  // ===== loans table (synced to Pipedrive) =====
  loan_number:      { type: 'text',   pdKey: PIPEDRIVE_FIELDS.loanNumber },
  loan_type:        { type: 'enum',   pdKey: PIPEDRIVE_FIELDS.loanType, optionMap: LOAN_TYPE_OPTION_MAP, validValues: LOAN_TYPES },
  loan_amount:      { type: 'number', pdKey: PIPEDRIVE_FIELDS.loanAmount },
  interest_rate:    { type: 'number', pdKey: PIPEDRIVE_FIELDS.interestRate },
  ltv:              { type: 'number', pdKey: PIPEDRIVE_FIELDS.ltv },
  arv:              { type: 'number', pdKey: PIPEDRIVE_FIELDS.arv },
  rehab_budget:     { type: 'number', pdKey: PIPEDRIVE_FIELDS.rehabBudget },
  term_months:      { type: 'number', pdKey: PIPEDRIVE_FIELDS.termMonths },
  origination_date: { type: 'date',   pdKey: PIPEDRIVE_FIELDS.originationDate },
  maturity_date:    { type: 'date',   pdKey: PIPEDRIVE_FIELDS.maturityDate },
  entity_name:      { type: 'text',   pdKey: PIPEDRIVE_FIELDS.entityName },

  // ===== loan_details table (portal-only, no Pipedrive sync) =====
  // Loan / Deal Overview
  investor_loan_number:    { type: 'text',     table: 'loan_details' },
  loan_application:        { type: 'text',     table: 'loan_details' },
  submitted_at:            { type: 'date',     table: 'loan_details' },
  urgency:                 { type: 'enum',     table: 'loan_details', validValues: URGENCY_OPTIONS },
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
  appraisal_received_date:  { type: 'date', table: 'loan_details' },
  appraisal_effective_date: { type: 'date', table: 'loan_details' },

  // Valuation / Collateral
  purchase_price:    { type: 'number', table: 'loan_details' },
  acquisition_date:  { type: 'date',   table: 'loan_details' },
  value_as_is:       { type: 'number', table: 'loan_details' },
  value_bpo:         { type: 'number', table: 'loan_details' },
  payoff:            { type: 'number', table: 'loan_details' },

  // Construction / Rehab
  construction_holdback: { type: 'number', table: 'loan_details' },
  draw_fee:              { type: 'number', table: 'loan_details' },

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

  // Loan Terms — Loan Type I (Purchase / Refi variants)
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

  // Title & Insurance contact info
  title_company:     { type: 'text', table: 'loan_details' },
  title_email:       { type: 'text', table: 'loan_details' },
  title_phone:       { type: 'text', table: 'loan_details' },
  insurance_company: { type: 'text', table: 'loan_details' },
  insurance_email:   { type: 'text', table: 'loan_details' },
  insurance_phone:   { type: 'text', table: 'loan_details' },

  // Vesting Entity (entity_name itself stays on loans table — it syncs to Pipedrive)
  vesting_in_entity:      { type: 'boolean', table: 'loan_details' },
  entity_type:            { type: 'enum',    table: 'loan_details', validValues: ENTITY_TYPE_OPTIONS },
  entity_formation_state: { type: 'text',    table: 'loan_details' },
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name').eq('auth_user_id', user.id).single(),
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
    if (table === 'loans') {
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

  // Get loan + verify access
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, pipedrive_deal_id, loan_officer_id, loan_processor_id, underwriter_id')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  if (!admin) {
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && loan.loan_processor_id === lp.id) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
    const { error } = await adminClient
      .from('loans')
      .update({ [field]: dbValue })
      .eq('id', loanId)
    if (error) {
      console.error('Local field update failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
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
  }

  // Audit log
  const editorName =
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    (admin ? 'Admin' : null)

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'field_updated',
      description: `${field} set to ${dbValue ?? '—'}${editorName ? ` by ${editorName}` : ''}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
