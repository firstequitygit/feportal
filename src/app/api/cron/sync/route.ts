import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllDeals } from '@/lib/pipedrive'

// Called automatically by Vercel every hour
// Also protected by CRON_SECRET so only Vercel can trigger it
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

    for (const deal of deals) {
      // Lost deals are non-claimable historical records — set archived=true.
      // Open / won are left alone (won is handled by the 30-day auto-archive cron once stage flips to Closed).
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
        last_synced_at:     new Date().toISOString(),
      }
      if (deal.pipedrive_status === 'lost') payload.archived = true

      const { error } = await supabase
        .from('loans')
        .upsert(payload, { onConflict: 'pipedrive_deal_id' })

      if (error) errors++
      else synced++
    }

    console.log(`Cron sync complete: ${synced} synced, ${errors} errors`)
    return NextResponse.json({ success: true, synced, errors, total: deals.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Cron sync error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
