import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DAYS = 30

// Runs nightly via Vercel cron.
// Archives any closed loan whose closed_at is more than 30 days ago.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const adminClient = createAdminClient()

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - DAYS)

    // Find closed loans that passed the 30-day threshold and aren't archived yet
    const { data: loans, error: fetchError } = await adminClient
      .from('loans')
      .select('id, property_address, closed_at')
      .eq('pipeline_stage', 'Closed')
      .lt('closed_at', cutoff.toISOString())
      .eq('archived', false)

    if (fetchError) {
      console.error('Auto-archive fetch error:', fetchError.message)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!loans || loans.length === 0) {
      console.log('Auto-archive: no loans to archive')
      return NextResponse.json({ success: true, archived: 0 })
    }

    let archived = 0
    let errors = 0

    for (const loan of loans) {
      const { error } = await adminClient.rpc('set_loan_archived', {
        p_loan_id: loan.id,
        p_archived: true,
      })

      if (error) {
        console.error(`Auto-archive failed for loan ${loan.id}:`, error.message)
        errors++
      } else {
        // Log the event
        await adminClient.from('loan_events').insert({
          loan_id: loan.id,
          event_type: 'loan_archived',
          description: `Loan automatically archived after ${DAYS} days in Closed status`,
        }).then(() => {})

        console.log(`Auto-archived: ${loan.property_address ?? loan.id}`)
        archived++
      }
    }

    console.log(`Auto-archive complete: ${archived} archived, ${errors} errors`)
    return NextResponse.json({ success: true, archived, errors })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Auto-archive error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
