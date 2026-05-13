import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeDeal, type PipedriveDeal } from '@/lib/pipedrive'
import { sendLoanApprovedEmail, sendLoanFundedEmail } from '@/lib/email'

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

    const wasApproved = existingLoan?.pipeline_stage === 'Submitted'
    const isNowApproved = deal.pipeline_stage === 'Submitted'
    const wasClosed = existingLoan?.pipeline_stage === 'Closed'
    const isNowClosed = deal.pipeline_stage === 'Closed'

    const { error } = await supabase
      .from('loans')
      .upsert(
        {
          pipedrive_deal_id:  deal.pipedrive_deal_id,
          property_address:   deal.property_address,
          pipeline_stage:     deal.pipeline_stage,
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
        },
        { onConflict: 'pipedrive_deal_id' }
      )

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

    console.log(`Synced deal ${dealId} — stage: ${deal.pipeline_stage}`)
    return NextResponse.json({ success: true, action: 'synced', dealId, stage: deal.pipeline_stage })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Webhook error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
