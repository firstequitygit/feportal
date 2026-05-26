// Hourly cron: reconcile portal Loan Details ↔ Airtable Deals base.
//
// Each run processes BATCH_SIZE loans ordered by oldest
// airtable_last_synced_at first, then stamps each loan's timestamp so the
// next run picks up where this one left off. The full base still can't
// fit in a single function call (~35 min at current volume), but with the
// Pro plan's 5-minute timeout we can move ~250 loans per hour — full
// rotation every ~10 hours.
//
// Protected by CRON_SECRET — only Vercel cron should hit this.

import { NextResponse } from 'next/server'
import { syncAllLoansToAirtable } from '@/lib/airtable'

export const maxDuration = 300

// Roughly 1s/loan worst-case (Supabase fetch + Airtable lookup + PATCH).
// 250 leaves ~50s of slack before Pro's 300s function cap kicks in.
const BATCH_SIZE = 250

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await syncAllLoansToAirtable({
      limit: BATCH_SIZE,
      oldestFirst: true,
    })
    console.log('Airtable cron sync done:', summary)
    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Airtable cron sync failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
