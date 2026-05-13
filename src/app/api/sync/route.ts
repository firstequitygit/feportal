import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllDeals } from '@/lib/pipedrive'
import { sendLoanApprovedEmail, sendLoanFundedEmail, sendStageUpdateEmail } from '@/lib/email'
import { recordStageChange } from '@/lib/stage-history'

export async function POST() {
  // Only authenticated staff (admin/LO/LP/UW) can trigger a sync
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const authClient = createAdminClient()
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    authClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    authClient.from('loan_officers').select('id').eq('auth_user_id', user.id).single(),
    authClient.from('loan_processors').select('id').eq('auth_user_id', user.id).single(),
    authClient.from('underwriters').select('id').eq('auth_user_id', user.id).single(),
  ])
  if (!admin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Step 1: Test Pipedrive connection
    let deals
    try {
      deals = await fetchAllDeals()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Pipedrive fetch failed: ${msg}` }, { status: 500 })
    }

    // Step 2: Test Supabase connection
    let supabase
    try {
      supabase = createAdminClient()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Supabase client failed: ${msg}` }, { status: 500 })
    }

    // Step 3: Fetch current stages so we can detect Submitted (Loan Approved) transitions
    const { data: existingLoans } = await supabase
      .from('loans')
      .select('id, pipedrive_deal_id, pipeline_stage')

    const currentStageMap: Record<number, { id: string; stage: string | null }> = {}
    for (const loan of existingLoans ?? []) {
      currentStageMap[loan.pipedrive_deal_id] = { id: loan.id, stage: loan.pipeline_stage }
    }

    // Step 4: Upsert deals
    let synced = 0
    let errors = 0
    const errorMessages: string[] = []

    for (const deal of deals) {
      const existing = currentStageMap[deal.pipedrive_deal_id]
      const previousStage = existing?.stage ?? null
      const wasApproved = previousStage === 'Submitted'
      const isNowApproved = deal.pipeline_stage === 'Submitted'
      const wasClosed = previousStage === 'Closed'
      const isNowClosed = deal.pipeline_stage === 'Closed'
      const stageChanged = !!existing && deal.pipeline_stage !== null && previousStage !== deal.pipeline_stage

      const { error } = await supabase
        .from('loans')
        .upsert(
          {
            pipedrive_deal_id:         deal.pipedrive_deal_id,
            property_address:          deal.property_address,
            pipeline_stage:            deal.pipeline_stage,
            loan_type:                 deal.loan_type,
            loan_amount:               deal.loan_amount,
            interest_rate:             deal.interest_rate,
            ltv:                       deal.ltv,
            arv:                       deal.arv,
            rehab_budget:              deal.rehab_budget,
            term_months:               deal.term_months ? Math.round(deal.term_months) : null,
            origination_date:          deal.origination_date,
            maturity_date:             deal.maturity_date,
            entity_name:               deal.entity_name,
            loan_number:               deal.loan_number,
            rate_locked_days:          deal.rate_locked_days,
            rate_lock_expiration_date: deal.rate_lock_expiration_date,
            interest_only:             deal.interest_only,
            loan_type_ii:              deal.loan_type_ii,
            last_synced_at:            new Date().toISOString(),
          },
          { onConflict: 'pipedrive_deal_id' }
        )

      if (error) {
        errorMessages.push(`Deal ${deal.pipedrive_deal_id}: ${error.message}`)
        errors++
      } else {
        synced++

        // Stage transition: track time-in-stage, then email.
        if (existing?.id && stageChanged) {
          if (deal.pipeline_stage) {
            try { await recordStageChange(existing.id, deal.pipeline_stage) }
            catch (err) { console.error(`Stage history failed for deal ${deal.pipedrive_deal_id}:`, err) }
          }
          // Submitted/Closed get specialized celebratory emails; everything
          // else gets the generic stage-update email. All three go to
          // borrower + LO + LP.
          try {
            if (isNowApproved && !wasApproved) {
              await sendLoanApprovedEmail(existing.id)
            } else if (isNowClosed && !wasClosed) {
              await sendLoanFundedEmail(existing.id)
            } else if (deal.pipeline_stage) {
              await sendStageUpdateEmail(existing.id, previousStage, deal.pipeline_stage)
            }
          } catch (err) {
            console.error(`Stage email failed for deal ${deal.pipedrive_deal_id}:`, err)
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      errors,
      total: deals.length,
      errorMessages,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Unexpected error: ${msg}` }, { status: 500 })
  }
}
