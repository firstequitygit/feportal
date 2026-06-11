import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllDeals } from '@/lib/pipedrive'
import { findOrLinkBorrower } from '@/lib/borrower-sync'
import { findOrLinkBroker } from '@/lib/broker-sync'
import { autoAssignDefaultUnderwriter } from '@/lib/auto-assign-underwriter'

/**
 * Only set `key` on `obj` when `value` is something Pipedrive actually has.
 * Used by the cron + manual sync to avoid clobbering portal-entered data
 * when Pipedrive returns null for a field.
 */
function setIfPresent(obj: Record<string, unknown>, key: string, value: unknown) {
  if (value === null || value === undefined) return
  if (typeof value === 'string' && value.trim() === '') return
  obj[key] = value
}

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

    // Pre-fetch current loan state keyed by pipedrive_deal_id. Lets us:
    //   - protect 'Conditionally Approved' from being clobbered back to UW
    //   - skip broker auto-assign when an admin already picked one
    const portalStageByDealId = new Map<string, string | null>()
    const portalBrokerByDealId = new Map<string, string | null>()
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from('loans').select('pipedrive_deal_id, pipeline_stage, broker_id')
        .not('pipedrive_deal_id', 'is', null)
        .range(from, from + 999)
      if (!data?.length) break
      for (const r of data) {
        portalStageByDealId.set(String(r.pipedrive_deal_id), r.pipeline_stage)
        portalBrokerByDealId.set(String(r.pipedrive_deal_id), r.broker_id ?? null)
      }
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

      // Broker auto-assign — only when Pipedrive has a broker AND the loan
      // doesn't already carry one (don't clobber an admin manual pick or
      // broker_id_2).
      let brokerId: string | null = null
      const existingBrokerId = portalBrokerByDealId.get(String(deal.pipedrive_deal_id))
      if (deal.broker_pipedrive_person_id && !existingBrokerId) {
        brokerId = await findOrLinkBroker(supabase, deal.broker_pipedrive_person_id)
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
      //
      // "Portal wins, Pipedrive backfills" policy — mirrors the Airtable sync.
      // Only write a field when Pipedrive actually has a value for it. Null
      // / undefined from Pipedrive used to clobber portal-entered values
      // (e.g. user enters loan_amount in the portal, push to Pipedrive fails
      // silently, next sync reads null and wipes the portal value). The
      // setIfPresent helper guards each field individually.
      const payload: Record<string, unknown> = {
        pipedrive_deal_id: deal.pipedrive_deal_id,
        last_synced_at:    new Date().toISOString(),
      }
      setIfPresent(payload, 'property_address',        deal.property_address)
      setIfPresent(payload, 'pipeline_stage',          effectivePipedriveStage)
      setIfPresent(payload, 'loan_type',               deal.loan_type)
      setIfPresent(payload, 'loan_amount',             deal.loan_amount)
      setIfPresent(payload, 'interest_rate',           deal.interest_rate)
      setIfPresent(payload, 'ltv',                     deal.ltv)
      setIfPresent(payload, 'arv',                     deal.arv)
      setIfPresent(payload, 'rehab_budget',            deal.rehab_budget)
      setIfPresent(payload, 'term_months',             deal.term_months ? Math.round(deal.term_months) : null)
      setIfPresent(payload, 'origination_date',        deal.origination_date)
      setIfPresent(payload, 'maturity_date',           deal.maturity_date)
      setIfPresent(payload, 'entity_name',             deal.entity_name)
      setIfPresent(payload, 'closed_at',               deal.closed_at)
      setIfPresent(payload, 'estimated_closing_date',  deal.estimated_closing_date)
      if (deal.pipedrive_status === 'lost') {
        // PIPEDRIVE_BRIDGE - remove when Pipedrive is sunsetted.
        // Mirror Pipedrive-direct cancellations into our lifecycle status so
        // the portal badge stays in sync. One-way assignment - we never
        // un-cancel via sync; admins do that explicitly in the portal.
        // All OTHER status writes (on_hold / active) are portal-authoritative
        // and never flow inbound from Pipedrive.
        payload.archived = true
        payload.loan_status = 'cancelled'
        if (deal.lost_reason) payload.cancellation_reason = deal.lost_reason
      }
      // Only write borrower_id when we actually resolved one. Skipping the
      // key (vs. writing null) avoids clobbering an admin-assigned borrower
      // on loans where Pipedrive has no person data.
      if (borrowerId) payload.borrower_id = borrowerId
      if (brokerId) payload.broker_id = brokerId

      // LO assignment: if Pipedrive's deal owner maps to a known portal LO,
      // mirror that into loan_officer_id. Same write-when-resolved pattern as
      // borrower_id — unmatched owners leave an existing manual assignment
      // intact rather than wiping it.
      if (deal.pipedrive_user_id != null) {
        const loId = loByPipedriveUserId.get(deal.pipedrive_user_id)
        if (loId) payload.loan_officer_id = loId
      }

      const { data: upserted, error } = await supabase
        .from('loans')
        .upsert(payload, { onConflict: 'pipedrive_deal_id' })
        .select('id')
        .single()

      if (error) errors++
      else synced++

      // Pre-Underwriting transition: auto-assign the default underwriter
      // (Alicyn) when no UW is set. The cron used to skip this — it was
      // the "silent backfill path" back when auto-assign sent an email.
      // The email is gone (June 2026), so the assignment is safe to run
      // from every sync path; this is how the Omvir Singh loan slipped
      // through unassigned. autoAssignDefaultUnderwriter no-ops when an
      // underwriter is already set.
      if (
        !error &&
        upserted?.id &&
        effectivePipedriveStage === 'Pre-Underwriting' &&
        portalStage !== 'Pre-Underwriting'
      ) {
        try { await autoAssignDefaultUnderwriter(supabase, upserted.id) }
        catch (err) { console.error(`Auto-assign UW failed for deal ${deal.pipedrive_deal_id}:`, err) }
      }
    }

    console.log(`Cron sync complete: ${synced} synced, ${errors} errors, ${borrowersLinked} borrowers linked`)
    return NextResponse.json({ success: true, synced, errors, borrowersLinked, total: deals.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Cron sync error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
