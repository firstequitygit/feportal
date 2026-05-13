import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateDealStage } from '@/lib/pipedrive'
import { sendLoanApprovedEmail, sendLoanFundedEmail, sendStageUpdateEmail } from '@/lib/email'
import { recordStageChange } from '@/lib/stage-history'
import { PIPEDRIVE_STAGE_MAP, PIPELINE_STAGES, type PipelineStage } from '@/lib/types'

// Inverse of PIPEDRIVE_STAGE_MAP — name → id
const STAGE_NAME_TO_ID: Record<string, number> = Object.entries(PIPEDRIVE_STAGE_MAP)
  .reduce((acc, [id, name]) => {
    acc[name] = Number(id)
    return acc
  }, {} as Record<string, number>)

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

  const { loanId, stage } = await req.json()
  if (!loanId || !stage) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!PIPELINE_STAGES.includes(stage as PipelineStage)) {
    return NextResponse.json({ error: 'Invalid stage' }, { status: 400 })
  }

  const stageId = STAGE_NAME_TO_ID[stage]
  if (!stageId) {
    return NextResponse.json({ error: `No Pipedrive stage_id mapped for "${stage}"` }, { status: 500 })
  }

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, pipedrive_deal_id, pipeline_stage, closed_at, loan_officer_id, loan_processor_id, underwriter_id, property_address')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  // Non-admins must be assigned to this loan
  if (!admin) {
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && loan.loan_processor_id === lp.id) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!loan.pipedrive_deal_id) {
    return NextResponse.json({ error: 'Loan has no Pipedrive deal id' }, { status: 400 })
  }

  // Already in the requested stage — no-op
  if (loan.pipeline_stage === stage) {
    return NextResponse.json({ success: true, unchanged: true })
  }

  const previousStage = loan.pipeline_stage as PipelineStage | null

  // Write to Pipedrive FIRST so we don't get out of sync if the API call fails
  try {
    await updateDealStage(loan.pipedrive_deal_id, stageId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipedrive update failed'
    console.error('updateDealStage failed:', msg)
    return NextResponse.json({ error: `Could not update Pipedrive: ${msg}` }, { status: 502 })
  }

  // Mirror locally. FE policy: moving a loan to Closed also archives it
  // immediately (no 30-day grace period). Sets closed_at if not already set.
  const updatePayload: Record<string, unknown> = { pipeline_stage: stage }
  if (stage === 'Closed') {
    updatePayload.archived = true
    if (!loan.closed_at) updatePayload.closed_at = new Date().toISOString()
  }
  const { error } = await adminClient
    .from('loans')
    .update(updatePayload)
    .eq('id', loanId)

  if (error) {
    console.error('Local stage update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Time-in-stage tracking for reporting
  try {
    await recordStageChange(loanId, stage)
  } catch (err) { console.error('Stage history error:', err) }

  // Audit log
  const editorName =
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    (admin ? 'Admin' : null)

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'stage_changed',
      description: `Stage moved from ${previousStage ?? 'Unknown'} to ${stage}${editorName ? ` by ${editorName}` : ''}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  // Notify borrower + LO + LP. Submitted (loan approved) and Closed have
  // specialized celebratory emails; everything else gets the generic
  // stage-update email.
  try {
    if (stage === 'Submitted' && previousStage !== 'Submitted') {
      await sendLoanApprovedEmail(loanId)
    } else if (stage === 'Closed' && previousStage !== 'Closed') {
      await sendLoanFundedEmail(loanId)
    } else {
      await sendStageUpdateEmail(loanId, previousStage, stage)
    }
  } catch (err) {
    console.error('Stage transition email error:', err)
  }

  return NextResponse.json({ success: true, previousStage, stage })
}
