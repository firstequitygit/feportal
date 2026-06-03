import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { updateDealStage } from '@/lib/pipedrive'
import { sendLoanApprovedEmail, sendLoanFundedEmail, sendStageUpdateEmail, sendPreUnderwritingClaimEmail, sendConditionallyApprovedAlert } from '@/lib/email'
import { autoAssignDefaultUnderwriter } from '@/lib/auto-assign-underwriter'
import { recordStageChange } from '@/lib/stage-history'
import { PIPEDRIVE_STAGE_MAP, PIPELINE_STAGES, type PipelineStage } from '@/lib/types'
import { syncLoanToAirtable } from '@/lib/airtable'

// Inverse of PIPEDRIVE_STAGE_MAP — name → id
const STAGE_NAME_TO_ID: Record<string, number> = Object.entries(PIPEDRIVE_STAGE_MAP)
  .reduce((acc, [id, name]) => {
    acc[name] = Number(id)
    return acc
  }, {} as Record<string, number>)

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

  const { loanId, stage } = await req.json()
  if (!loanId || !stage) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!PIPELINE_STAGES.includes(stage as PipelineStage)) {
    return NextResponse.json({ error: 'Invalid stage' }, { status: 400 })
  }

  // 'Conditionally Approved' is portal-only — no Pipedrive equivalent.
  // For all other stages we push the matching Pipedrive stage_id.
  const isPortalOnlyStage = stage === 'Conditionally Approved'
  const stageId = isPortalOnlyStage ? null : STAGE_NAME_TO_ID[stage]
  if (!isPortalOnlyStage && !stageId) {
    return NextResponse.json({ error: `No Pipedrive stage_id mapped for "${stage}"` }, { status: 500 })
  }

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, pipedrive_deal_id, pipeline_stage, closed_at, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id, property_address')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  // Non-admins must be assigned to this loan
  if (!admin) {
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (lp.is_ops_manager || loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
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

  // Write to Pipedrive FIRST so we don't get out of sync if the API call fails.
  // Skip when moving to a portal-only stage (Conditionally Approved) — that
  // stage doesn't exist in Pipedrive, so we leave the deal in Underwriting.
  if (!isPortalOnlyStage && stageId) {
    try {
      await updateDealStage(loan.pipedrive_deal_id, stageId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipedrive update failed'
      console.error('updateDealStage failed:', msg)
      return NextResponse.json({ error: `Could not update Pipedrive: ${msg}` }, { status: 502 })
    }
  }

  // Mirror locally. Moving a loan to Closed stamps closed_at when
  // missing so the 30-day auto-archive cron has a baseline. We deliberately
  // do NOT archive here — the LO/LP/UW Closed bucket needs to keep
  // recently-closed loans visible for ~30 days post-close. The cron
  // (/api/cron/auto-archive) handles the eventual archive sweep. Earlier
  // behavior was archiving immediately on the stage flip, which caused
  // freshly closed loans (e.g. 1023 Monroe Ave on 2026-06-02) to vanish
  // from the active list the moment they were marked Closed.
  const updatePayload: Record<string, unknown> = { pipeline_stage: stage }
  if (stage === 'Closed' && !loan.closed_at) {
    updatePayload.closed_at = new Date().toISOString()
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

  // Push the stage change to Airtable immediately — same model as the
  // Pipedrive push at the top of this route, so all three systems
  // (portal, Pipedrive, Airtable) stay in lockstep on stage transitions
  // instead of Airtable waiting up to an hour for the next cron rotation.
  // Failures are logged but don't fail the request; the field map will
  // pick up the change on the next sync. New Application maps to
  // "undefined" in the field mapper so loans not yet in Airtable safely
  // no-op (syncLoanToAirtable returns 'skipped-no-airtable-row').
  try {
    await syncLoanToAirtable(loanId)
  } catch (err) {
    console.error('Airtable stage push failed:', err instanceof Error ? err.message : err)
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
      event_type: 'stage_changed',
      description: `Stage moved from ${previousStage ?? 'Unknown'} to ${stage}${editorName ? ` by ${editorName}` : ''}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  // Notify borrower + LO + LP. Submitted (loan approved) and Closed have
  // specialized celebratory emails; everything else gets the generic
  // stage-update email.
  try {
    if (stage === 'Approved' && previousStage !== 'Approved') {
      await sendLoanApprovedEmail(loanId)
    } else if (stage === 'Closed' && previousStage !== 'Closed') {
      await sendLoanFundedEmail(loanId)
    } else {
      await sendStageUpdateEmail(loanId, previousStage, stage)
    }
  } catch (err) {
    console.error('Stage transition email error:', err)
  }

  // Pre-Underwriting transition:
  //   1. Auto-assign the default underwriter (Alicyn) when no UW is set yet.
  //      Loans now arrive in her queue directly instead of needing a manual
  //      claim from the team.
  //   2. sendPreUnderwritingClaimEmail runs as a fallback — it's already
  //      a no-op when underwriter_id is set, so a successful auto-assign
  //      silently skips the team blast.
  if (stage === 'Pre-Underwriting' && previousStage !== 'Pre-Underwriting') {
    try { await autoAssignDefaultUnderwriter(adminClient, loanId) }
    catch (err) { console.error('Auto-assign UW error:', err) }

    try { await sendPreUnderwritingClaimEmail(loanId) }
    catch (err) { console.error('Pre-UW claim email error:', err) }
  }

  // Conditionally Approved transition:
  //   1. Auto-assign Omayra as LP #2 if she isn't already on the loan and
  //      the slot is empty — without this, the email link she gets opens to
  //      a 404 because the LP loan detail page requires assignment.
  //   2. Send her the alert email (after the assignment lands, so the link
  //      works on first click).
  // Portal-only stage — this is the only place that triggers either step.
  if (stage === 'Conditionally Approved' && previousStage !== 'Conditionally Approved') {
    try {
      const { data: omayra } = await adminClient
        .from('loan_processors')
        .select('id, full_name')
        .eq('email', 'ocartagena@fefunding.com')
        .maybeSingle()

      const alreadyOnLoan =
        omayra &&
        (loan.loan_processor_id === omayra.id || loan.loan_processor_id_2 === omayra.id)

      if (omayra && !alreadyOnLoan && !loan.loan_processor_id_2) {
        const { error: assignErr } = await adminClient
          .from('loans')
          .update({ loan_processor_id_2: omayra.id })
          .eq('id', loanId)

        if (assignErr) {
          console.error('Omayra LP #2 assign error:', assignErr.message)
        } else {
          await adminClient.from('loan_events').insert({
            loan_id: loanId,
            event_type: 'loan_processor_assigned',
            description: `${omayra.full_name} auto-assigned as Loan Processor on Conditionally Approved transition`,
          }).then(() => {}, err => console.error('Auto-assign event log error:', err))
        }
      }
    } catch (err) {
      console.error('Omayra auto-assign lookup error:', err)
    }

    try { await sendConditionallyApprovedAlert(loanId) }
    catch (err) { console.error('Conditionally Approved alert error:', err) }
  }

  return NextResponse.json({ success: true, previousStage, stage })
}
