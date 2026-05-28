import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeDeal, type PipedriveDeal } from '@/lib/pipedrive'
import { sendLoanApprovedEmail, sendLoanFundedEmail, sendPreUnderwritingClaimEmail } from '@/lib/email'
import { autoAssignDefaultUnderwriter } from '@/lib/auto-assign-underwriter'

export async function GET() {
  return NextResponse.json({ received: true, method: 'GET', note: 'Pipedrive should POST, not GET' })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log('Pipedrive webhook received:', JSON.stringify(body, null, 2))

    // Pipedrive Automated Webhooks put the deal in body.data
    // Classic webhooks put it in body.current with body.meta.action/object
    const dealData: PipedriveDeal | null = body.data ?? body.current ?? null
    const meta = body.meta

    // Detect deletion: classic format uses meta.action, automated may not have it
    const isDelete = meta?.action === 'deleted'

    // Deal ID: automated format has it in body.data.id, classic in meta.id
    const dealId: number | undefined = dealData?.id ?? meta?.id

    console.log('Deal ID:', dealId, '| isDelete:', isDelete)
    console.log('Has deal data:', !!dealData)

    if (!dealId) {
      console.log('No deal ID — skipping. Full body keys:', Object.keys(body))
      return NextResponse.json({ received: true, skipped: true, reason: 'no_deal_id' })
    }

    const supabase = createAdminClient()

    if (isDelete) {
      await supabase.from('loans').delete().eq('pipedrive_deal_id', dealId)
      console.log(`Deleted deal ${dealId}`)
      return NextResponse.json({ success: true, action: 'deleted', dealId })
    }

    if (!dealData) {
      console.error('No deal data in payload')
      return NextResponse.json({ error: 'No deal data in payload' }, { status: 400 })
    }

    // Normalize the deal data from the webhook payload directly — no extra API call needed
    const deal = normalizeDeal(dealData)
    console.log('Normalized deal:', JSON.stringify(deal))

    // Fetch current stage before upserting to detect Submitted (Loan Approved) transition
    const { data: existingLoan } = await supabase
      .from('loans')
      .select('id, pipeline_stage')
      .eq('pipedrive_deal_id', dealId)
      .single()

    const wasApproved = existingLoan?.pipeline_stage === 'Approved'
    const isNowApproved = deal.pipeline_stage === 'Approved'
    const wasClosed = existingLoan?.pipeline_stage === 'Closed'
    const isNowClosed = deal.pipeline_stage === 'Closed'
    const wasPreUW = existingLoan?.pipeline_stage === 'Pre-Underwriting'
    const isNowPreUW = deal.pipeline_stage === 'Pre-Underwriting'

    // 'Conditionally Approved' is portal-only — Pipedrive keeps the loan in
    // 'Underwriting'. Preserve the portal value when that's what's happening.
    const effectivePipedriveStage =
      existingLoan?.pipeline_stage === 'Conditionally Approved' && deal.pipeline_stage === 'Underwriting'
        ? 'Conditionally Approved'
        : deal.pipeline_stage

    // Skip non-Pipeline-2 deals — only the Deals Pipeline syncs to the portal.
    if (deal.pipedrive_pipeline_id !== 2) {
      console.log(`Skipping deal ${dealId} — pipeline_id=${deal.pipedrive_pipeline_id}, not Deals Pipeline`)
      return NextResponse.json({ received: true, skipped: true, reason: 'not_deals_pipeline' })
    }

    // archived rule (per FE policy):
    //   pipedrive_status=open → archived=false (active, claimable)
    //   anything else (won/lost) → archived=true (out of the active flow)
    // lost also flips our lifecycle status to cancelled so the portal badge
    // mirrors Pipedrive. One-way — we never un-cancel via sync.
    const archivedField: Record<string, unknown> = { archived: deal.pipedrive_status !== 'open' }
    if (deal.pipedrive_status === 'lost') {
      archivedField.loan_status = 'cancelled'
      if (deal.lost_reason) archivedField.cancellation_reason = deal.lost_reason
    }

    // Pipedrive deal owner → portal LO. Lookup is a single-row query since
    // the webhook only processes one deal at a time.
    let resolvedLoId: string | null = null
    if (deal.pipedrive_user_id != null) {
      const { data: loMatch } = await supabase
        .from('loan_officers').select('id')
        .eq('pipedrive_user_id', deal.pipedrive_user_id)
        .maybeSingle()
      if (loMatch) resolvedLoId = loMatch.id
    }

    const upsertPayload: Record<string, unknown> = {
      pipedrive_deal_id:  deal.pipedrive_deal_id,
      property_address:   deal.property_address,
      pipeline_stage:     effectivePipedriveStage,
      loan_type:          deal.loan_type,
      loan_amount:        deal.loan_amount,
      interest_rate:      deal.interest_rate,
      ltv:                deal.ltv,
      arv:                deal.arv,
      rehab_budget:       deal.rehab_budget,
      term_months:        deal.term_months ? Math.round(deal.term_months) : null,
      origination_date:   deal.origination_date,
      maturity_date:      deal.maturity_date,
      entity_name:        deal.entity_name,
      last_synced_at:     new Date().toISOString(),
      ...archivedField,
    }
    if (resolvedLoId) upsertPayload.loan_officer_id = resolvedLoId

    const { error } = await supabase
      .from('loans')
      .upsert(upsertPayload, { onConflict: 'pipedrive_deal_id' })

    if (error) {
      console.error(`Failed to sync deal ${dealId}:`, error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Send "Loan Approved" email if this is a new transition to Submitted
    if (isNowApproved && !wasApproved && existingLoan?.id) {
      try {
        await sendLoanApprovedEmail(existingLoan.id)
        console.log(`Loan Approved email sent for deal ${dealId}`)
      } catch (err) {
        console.error(`Loan Approved email failed for deal ${dealId}:`, err)
      }
    }

    // Send "Loan Funded" email if this is a new transition to Closed
    if (isNowClosed && !wasClosed && existingLoan?.id) {
      try {
        await sendLoanFundedEmail(existingLoan.id)
        console.log(`Loan Funded email sent for deal ${dealId}`)
      } catch (err) {
        console.error(`Loan Funded email failed for deal ${dealId}:`, err)
      }
    }

    // Pre-Underwriting: auto-assign Alicyn (no-op if already assigned),
    // then call the team-claim blast which itself no-ops when underwriter_id
    // is set. A successful auto-assign therefore silently skips the blast.
    if (isNowPreUW && !wasPreUW && existingLoan?.id) {
      try {
        await autoAssignDefaultUnderwriter(supabase, existingLoan.id)
      } catch (err) {
        console.error(`Auto-assign UW failed for deal ${dealId}:`, err)
      }
      try {
        await sendPreUnderwritingClaimEmail(existingLoan.id)
        console.log(`Pre-UW notifications complete for deal ${dealId}`)
      } catch (err) {
        console.error(`Pre-UW claim email failed for deal ${dealId}:`, err)
      }
    }

    console.log(`Synced deal ${dealId} — stage: ${deal.pipeline_stage}`)
    return NextResponse.json({ success: true, action: 'synced', dealId, stage: deal.pipeline_stage })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Webhook error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
