import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Generic editor for borrower-level fields (address, etc.).
 *
 * Uses the same `{ loanId, field, value }` body shape as /api/loans/field
 * so the EditableLoanField component can be reused unchanged. We resolve
 * the borrower from the loan's borrower_id; updates go to the borrowers
 * table and an audit event is written to loan_events.
 */

type FieldType = 'text' | 'boolean'

interface FieldConfig {
  type: FieldType
}

const FIELD_WHITELIST: Record<string, FieldConfig> = {
  current_address_street: { type: 'text' },
  current_address_city:   { type: 'text' },
  current_address_state:  { type: 'text' },
  current_address_zip:    { type: 'text' },
  at_current_address_2y:  { type: 'boolean' },
  prior_address_street:   { type: 'text' },
  prior_address_city:     { type: 'text' },
  prior_address_state:    { type: 'text' },
  prior_address_zip:      { type: 'text' },
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

  // Coerce + validate value
  let dbValue: string | boolean | null = null
  if (value === null || value === '' || value === undefined) {
    dbValue = null
  } else if (config.type === 'boolean') {
    dbValue = Boolean(value)
  } else {
    if (typeof value !== 'string') return NextResponse.json({ error: 'Invalid text value' }, { status: 400 })
    dbValue = value.trim() || null
  }

  // Get loan + verify access
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, borrower_id, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (!loan.borrower_id) {
    return NextResponse.json({ error: 'No borrower assigned to this loan' }, { status: 400 })
  }

  if (!admin) {
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminClient
    .from('borrowers')
    .update({ [field]: dbValue })
    .eq('id', loan.borrower_id)

  if (error) {
    console.error('Borrower field update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const editorName =
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    (admin ? 'Admin' : null)

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'borrower_field_updated',
      description: `Borrower field ${field} set to ${dbValue ?? '—'}${editorName ? ` by ${editorName}` : ''}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
