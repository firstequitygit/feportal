import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllDeals } from '@/lib/pipedrive'
import { findOrLinkBorrower } from '@/lib/borrower-sync'

// Called automatically by Vercel cron.
// Also protected by CRON_SECRET so only Vercel can trigger it.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const deals = await fetchAllDeals()

    // Pre-fetch current portal stages keyed by pipedrive_deal_id. Lets us
    // protect the portal-only 'Conditionally Approved' stage from being
    // clobbered by a Pipedrive 'Underwriting' on the same loan.
    const portalStageByDealId = new Map<string, string | null>()
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from('loans').select('pipedrive_deal_id, pipeline_stage')
        .not('pipedrive_deal_id', 'is', null)
        .range(from, from + 999)
      if (!data?.length) break
      for (const r of data) portalStageByDealId.set(String(r.pipedrive_deal_id), r.pipeline_stage)
      if (data.length < 1000) break
    }

    // Pre-fetch loan_officers with a Pipedrive user mapping so we can assign
    // loan_officer_id off the Pipedrive deal owner. LOs without a mapping
    // are simply skipped — their loans won't be auto-assigned.
    const loByPipedriveUserId = new Map<number, string>()
    const { data: lpdMap } = await supabase
      .from('loan_officers').select('id, pipedrive_user_id')
      .not('pipedrive_user_id', 'is', null)
    for (const r of lpdMap ?? []) {
      if (r.pipedrive_user_id != null) loByPipedriveUserId.set(r.pipedrive_user_id, r.id)
    }

    let synced = 0
    let errors = 0
    let borrowersLinked = 0

    for (const deal of deals) {
      // Resolve the borrower row from Pipedrive Person data. Loans where
      // Pipedrive has no person, or no person email, end up with borrower_id
      // null — admin can still assign manually via the loan detail page.
      let borrowerId: string | null = null
      if (deal.pipedrive_person_id) {
        borrowerId = await findOrLinkBorrower(supabase, {
          pipedrive_person_id: deal.pipedrive_person_id,
          full_name: deal.borrower_name,
          email:     deal.borrower_email,
          phone:     deal.borrower_phone,
        })
        if (borrowerId) borrowersLinked++
      }

      // 'Conditionally Approved' is portal-only. Pipedrive keeps such loans
      // in 'Underwriting' — don't let that overwrite the portal value.
      const portalStage = portalStageByDealId.get(String(deal.pipedrive_deal_id))
      const effectivePipedriveStage =
        portalStage === 'Conditionally Approved' && deal.pipeline_stage === 'Underwriting'
          ? 'Conditionally Approved'
          : deal.pipeline_stage

      // Lost deals are non-claimable historical records — set archived=true.
      // Open / won are left alone (won goes through the 30-day auto-archive cron once stage flips to Closed).
      const payload: Record<string, unknown> = {
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
        closed_at:               deal.closed_at,                // Pipedrive won_time for won deals
        estimated_closing_date:  deal.estimated_closing_date,   // Pipedrive "Closing Date" custom field
        last_synced_at:     new Date().toISOString(),
      }
      if (deal.pipedrive_status === 'lost') {
        // Mirror Pipedrive-direct cancellations into our lifecycle status so
        // the portal badge stays in sync. One-way assignment — we never
        // un-cancel via sync; admins do that explicitly in the portal.
        payload.archived = true
        payload.loan_status = 'cancelled'
        if (deal.lost_reason) payload.cancellation_reason = deal.lost_reason
      }
      // Only write borrower_id when we actually resolved one. Skipping the
      // key (vs. writing null) avoids clobbering an admin-assigned borrower
      // on loans where Pipedrive has no person data.
      if (borrowerId) payload.borrower_id = borrowerId

      // LO assignment: if Pipedrive's deal owner maps to a known portal LO,
      // mirror that into loan_officer_id. Same write-when-resolved pattern as
      // borrower_id — unmatched owners leave an existing manual assignment
      // intact rather than wiping it.
      if (deal.pipedrive_user_id != null) {
        const loId = loByPipedriveUserId.get(deal.pipedrive_user_id)
        if (loId) payload.loan_officer_id = loId
      }

      const { error } = await supabase
        .from('loans')
        .upsert(payload, { onConflict: 'pipedrive_deal_id' })

      if (error) errors++
      else synced++
    }

    console.log(`Cron sync complete: ${synced} synced, ${errors} errors, ${borrowersLinked} borrowers linked`)
    return NextResponse.json({ success: true, synced, errors, borrowersLinked, total: deals.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Cron sync error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
