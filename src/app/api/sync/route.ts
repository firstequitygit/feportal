import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllDeals } from '@/lib/pipedrive'

/**
 * Only set `key` on `obj` when `value` is something Pipedrive actually has.
 * Mirrors the helper in /api/cron/sync — both routes need the same
 * "don't clobber portal data with Pipedrive null" behavior.
 */
function setIfPresent(obj: Record<string, unknown>, key: string, value: unknown) {
  if (value === null || value === undefined) return
  if (typeof value === 'string' && value.trim() === '') return
  obj[key] = value
}
import { sendLoanApprovedEmail, sendLoanFundedEmail, sendStageUpdateEmail, sendPreUnderwritingClaimEmail } from '@/lib/email'
import { autoAssignDefaultUnderwriter } from '@/lib/auto-assign-underwriter'
import { recordStageChange } from '@/lib/stage-history'
import { findOrLinkBorrower } from '@/lib/borrower-sync'
import { findOrLinkBroker } from '@/lib/broker-sync'
import { assertNotImpersonating } from '@/lib/impersonate'

export async function POST() {
  const block = await assertNotImpersonating()
  if (block) return block
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

    // Step 3: Pre-fetch current loan state so we can:
    //   - detect Submitted (Loan Approved) transitions
    //   - protect Conditionally Approved from being clobbered back to UW
    //   - skip broker auto-assign when an admin already picked one
    //
    // MUST paginate. A single .select() is silently capped at 1000 rows
    // by PostgREST. Without this loop, loans past row 1000 came back with
    // no previous state, the Conditionally Approved preservation guard
    // never fired, and the upsert flipped them to Pipedrive's UW.
    const currentLoanMap: Record<number, { id: string; stage: string | null; broker_id: string | null }> = {}
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('loans')
        .select('id, pipedrive_deal_id, pipeline_stage, broker_id')
        .not('pipedrive_deal_id', 'is', null)
        .range(from, from + 999)
      if (error || !data?.length) break
      for (const loan of data) {
        currentLoanMap[loan.pipedrive_deal_id] = {
          id: loan.id,
          stage: loan.pipeline_stage,
          broker_id: loan.broker_id ?? null,
        }
      }
      if (data.length < 1000) break
    }
    // Backwards-compat alias used by the rest of this route.
    const currentStageMap = currentLoanMap

    // Step 4: Upsert deals
    let synced = 0
    let errors = 0
    const errorMessages: string[] = []

    // LO Pipedrive-user mapping. Pre-fetch once; used per deal to assign
    // loan_officer_id from the Pipedrive deal owner.
    const loByPipedriveUserId = new Map<number, string>()
    const { data: lpdMap } = await supabase
      .from('loan_officers').select('id, pipedrive_user_id')
      .not('pipedrive_user_id', 'is', null)
    for (const r of lpdMap ?? []) {
      if (r.pipedrive_user_id != null) loByPipedriveUserId.set(r.pipedrive_user_id, r.id)
    }

    let borrowersLinked = 0
    for (const deal of deals) {
      const existing = currentStageMap[deal.pipedrive_deal_id]
      const previousStage = existing?.stage ?? null
      const wasApproved = previousStage === 'Approved'
      const isNowApproved = deal.pipeline_stage === 'Approved'
      const wasClosed = previousStage === 'Closed'
      const isNowClosed = deal.pipeline_stage === 'Closed'
      // 'Conditionally Approved' (portal-only) is treated as equivalent to
      // Pipedrive's 'Underwriting' — Pipedrive sending Underwriting on a
      // loan already in Conditionally Approved is not a real transition.
      const effectivePipedriveStage =
        previousStage === 'Conditionally Approved' && deal.pipeline_stage === 'Underwriting'
          ? 'Conditionally Approved'
          : deal.pipeline_stage
      const stageChanged = !!existing && effectivePipedriveStage !== null && previousStage !== effectivePipedriveStage

      // Resolve / create the borrower row from Pipedrive Person data.
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

      // Resolve / create the broker row from Pipedrive's "Broker" custom
      // Person field. Only auto-assigns when the loan has no existing
      // broker — preserves admin manual assignments and broker_id_2.
      let brokerId: string | null = null
      if (deal.broker_pipedrive_person_id && !existing?.broker_id) {
        brokerId = await findOrLinkBroker(supabase, deal.broker_pipedrive_person_id)
      }

      // archived rule (matches cron sync): only lost deals get archived
      // automatically. Won deals stay until the 30-day post-Closed cron
      // promotes them. Open deals stay claimable.
      // Lost deals also flip our lifecycle status to cancelled so the portal
      // badge mirrors Pipedrive. One-way — we never un-cancel via sync.
      const archivedField: Record<string, unknown> = {}
      if (deal.pipedrive_status === 'lost') {
        archivedField.archived = true
        archivedField.loan_status = 'cancelled'
        if (deal.lost_reason) archivedField.cancellation_reason = deal.lost_reason
      }

      // "Portal wins, Pipedrive backfills" — only write a field when
      // Pipedrive has a value. Pipedrive nulls used to clobber portal
      // edits (e.g. loan_amount, estimated_closing_date). See cron route
      // for the matching change.
      const payload: Record<string, unknown> = {
        pipedrive_deal_id: deal.pipedrive_deal_id,
        last_synced_at:    new Date().toISOString(),
        ...archivedField,
      }
      setIfPresent(payload, 'property_address',          deal.property_address)
      setIfPresent(payload, 'pipeline_stage',            effectivePipedriveStage)
      setIfPresent(payload, 'loan_type',                 deal.loan_type)
      setIfPresent(payload, 'loan_amount',               deal.loan_amount)
      setIfPresent(payload, 'interest_rate',             deal.interest_rate)
      setIfPresent(payload, 'ltv',                       deal.ltv)
      setIfPresent(payload, 'arv',                       deal.arv)
      setIfPresent(payload, 'rehab_budget',              deal.rehab_budget)
      setIfPresent(payload, 'term_months',               deal.term_months ? Math.round(deal.term_months) : null)
      setIfPresent(payload, 'origination_date',          deal.origination_date)
      setIfPresent(payload, 'maturity_date',             deal.maturity_date)
      setIfPresent(payload, 'entity_name',               deal.entity_name)
      setIfPresent(payload, 'loan_number',               deal.loan_number)
      // rate_locked_days is intentionally NOT pulled — the portal stores
      // granularity (No / 15 / 30 / 45 days) that Pipedrive's yes-only
      // "Locked?" enum can't represent. Pulling would clobber the days
      // value back to "Yes". Pushes still happen on portal edits via
      // /api/loans/field.
      setIfPresent(payload, 'rate_lock_expiration_date', deal.rate_lock_expiration_date)
      setIfPresent(payload, 'interest_only',             deal.interest_only)
      setIfPresent(payload, 'closed_at',                 deal.closed_at)
      setIfPresent(payload, 'estimated_closing_date',    deal.estimated_closing_date)
      // Don't clobber an admin-assigned borrower when Pipedrive has no person.
      if (borrowerId) payload.borrower_id = borrowerId

      // Auto-assign broker only when we just resolved one AND the loan had
      // no existing broker (existing?.broker_id check above gated brokerId).
      if (brokerId) payload.broker_id = brokerId

      // Pipedrive deal owner → portal LO (when a mapping exists).
      if (deal.pipedrive_user_id != null) {
        const loId = loByPipedriveUserId.get(deal.pipedrive_user_id)
        if (loId) payload.loan_officer_id = loId
      }

      const { error } = await supabase
        .from('loans')
        .upsert(payload, { onConflict: 'pipedrive_deal_id' })

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
          // Pre-Underwriting: auto-assign Alicyn (if no UW yet) + fall back
          // to the team-claim blast. sendPreUnderwritingClaimEmail no-ops
          // when underwriter_id is set, so a successful auto-assign silently
          // skips the blast.
          if (deal.pipeline_stage === 'Pre-Underwriting' && previousStage !== 'Pre-Underwriting') {
            try { await autoAssignDefaultUnderwriter(supabase, existing.id) }
            catch (err) { console.error(`Auto-assign UW failed for deal ${deal.pipedrive_deal_id}:`, err) }

            try { await sendPreUnderwritingClaimEmail(existing.id) }
            catch (err) { console.error(`Pre-UW claim email failed for deal ${deal.pipedrive_deal_id}:`, err) }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      errors,
      borrowersLinked,
      total: deals.length,
      errorMessages,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Unexpected error: ${msg}` }, { status: 500 })
  }
}
