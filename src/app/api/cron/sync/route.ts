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

      // Lost deals are non-claimable historical records — set archived=true.
      // Open / won are left alone (won goes through the 30-day auto-archive cron once stage flips to Closed).
      const payload: Record<string, unknown> = {
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
        closed_at:               deal.closed_at,                // Pipedrive won_time for won deals
        estimated_closing_date:  deal.estimated_closing_date,   // Pipedrive "Closing Date" custom field
        last_synced_at:     new Date().toISOString(),
      }
      if (deal.pipedrive_status === 'lost') payload.archived = true
      // Only write borrower_id when we actually resolved one. Skipping the
      // key (vs. writing null) avoids clobbering an admin-assigned borrower
      // on loans where Pipedrive has no person data.
      if (borrowerId) payload.borrower_id = borrowerId

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
