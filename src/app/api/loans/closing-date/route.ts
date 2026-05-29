import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { updateDealField } from '@/lib/pipedrive'
import { PIPEDRIVE_FIELDS } from '@/lib/types'

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

  const { loanId, estimatedClosingDate } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  let safeDate: string | null = null
  if (estimatedClosingDate) {
    const parsed = new Date(estimatedClosingDate)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
    safeDate = estimatedClosingDate
  }

  // Non-admins must be assigned to this loan
  if (!admin) {
    const { data: loan } = await adminClient
      .from('loans')
      .select('loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
      .eq('id', loanId)
      .single()
    if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (lp.is_ops_manager || loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
      (uw && loan.underwriter_id === uw.id)

    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Need the Pipedrive deal id so we can push the new value back. Without
  // this, the next cron sync would read Pipedrive's stale value and clobber
  // the portal edit we're about to make.
  const { data: existing } = await adminClient
    .from('loans')
    .select('pipedrive_deal_id')
    .eq('id', loanId)
    .single()

  const { error } = await adminClient
    .from('loans')
    .update({ estimated_closing_date: safeDate })
    .eq('id', loanId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Push to Pipedrive's "Closing Date" custom field. If we don't do this,
  // the field stays null in Pipedrive and the next sync (cron or manual)
  // pulls null back into the portal, wiping the edit we just made.
  // Failures are logged but don't fail the whole request — the portal write
  // already succeeded and the sync defense ("don't overwrite portal with
  // null") will keep the value intact even if the Pipedrive push misses.
  let pipedrivePushed = true
  let pipedrivePushError: string | null = null
  if (existing?.pipedrive_deal_id) {
    try {
      await updateDealField(existing.pipedrive_deal_id, PIPEDRIVE_FIELDS.closingDate, safeDate)
    } catch (err) {
      pipedrivePushed = false
      pipedrivePushError = err instanceof Error ? err.message : String(err)
      console.error('Pipedrive closing-date push failed:', pipedrivePushError)
    }
  }

  const editorName =
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    (admin ? 'Admin' : null)

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'closing_date_updated',
      description: safeDate
        ? `Estimated closing date set to ${safeDate}${editorName ? ` by ${editorName}` : ''}${pipedrivePushed ? '' : ' (Pipedrive push failed)'}`
        : `Estimated closing date cleared${editorName ? ` by ${editorName}` : ''}${pipedrivePushed ? '' : ' (Pipedrive push failed)'}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true, pipedrivePushed, pipedrivePushError })
}
