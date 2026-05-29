import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeDeal, fetchEnumOptions, type PipedriveDeal } from '@/lib/pipedrive'
import { PIPEDRIVE_FIELDS } from '@/lib/types'
import { sendLoanApprovedEmail, sendLoanFundedEmail, sendPreUnderwritingClaimEmail } from '@/lib/email'
import { autoAssignDefaultUnderwriter } from '@/lib/auto-assign-underwriter'
import { findOrLinkBroker } from '@/lib/broker-sync'

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

    // Normalize the deal data from the webhook payload directly — no extra
    // API call for the deal itself, but we pre-fetch enum option labels so
    // fields like Interest Only resolve to "Yes"/"No" instead of raw ids.
    const optionsMap = await fetchEnumOptions(
      PIPEDRIVE_FIELDS.interestOnly,
      PIPEDRIVE_FIELDS.rateLocked,
      PIPEDRIVE_FIELDS.loanTypeII,
    )
    const deal = normalizeDeal(dealData, optionsMap)
    console.log('Normalized deal:', JSON.stringify(deal))

    // Fetch current state before upserting — drives both the CA stage
    // preservation and the "skip broker auto-assign if already set" guard.
    const { data: existingLoan } = await supabase
      .from('loans')
      .select('id, pipeline_stage, broker_id')
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

    // archived rule (matches /api/cron/sync and /api/sync):
    //   pipedrive_status=lost → archived=true (cancelled, non-claimable)
    //   pipedrive_status=won  → leave archived alone; the 30-day
    //                           auto-archive cron promotes won deals out
    //                           of the active list once they sit in
    //                           Closed for a month.
    //   pipedrive_status=open → leave archived alone (don't un-archive a
    //                           deal an admin explicitly archived).
    // Lost also flips our lifecycle status to cancelled so the portal
    // badge mirrors Pipedrive. One-way — we never un-cancel via sync.
    //
    // Earlier version was `archived: status !== 'open'`, which archived
    // won deals the instant Pipedrive flipped the flag — so freshly
    // closed loans vanished from the LO's Closed bucket. Bug surfaced
    // when 65 Dayton (5/28) and 2534 Hansford (5/22) disappeared while
    // 8595 Creekwood (5/19) stuck around (webhook didn't fire for it).
    const archivedField: Record<string, unknown> = {}
    if (deal.pipedrive_status === 'lost') {
      archivedField.archived = true
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

    // Broker auto-assign — only when Pipedrive has a broker AND the loan
    // doesn't already carry one. Done inline so we don't add a Pipedrive
    // call when there's nothing to resolve.
    let resolvedBrokerId: string | null = null
    if (deal.broker_pipedrive_person_id && !existingLoan?.broker_id) {
      resolvedBrokerId = await findOrLinkBroker(supabase, deal.broker_pipedrive_person_id)
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
    if (resolvedBrokerId) upsertPayload.broker_id = resolvedBrokerId

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
