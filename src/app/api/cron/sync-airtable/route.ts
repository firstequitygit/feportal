// Hourly cron: reconcile portal Loan Details ↔ Airtable Deals base.
//
// Vercel Hobby caps function execution around 60s, so we can't sync 2000+
// loans in one shot. Each run processes BATCH_SIZE loans ordered by oldest
// airtable_last_synced_at first, then stamps each loan's timestamp so the
// next run picks up where this one left off. Full base rotates in
// ~ceil(total / BATCH_SIZE) hours — about two days for the current
// dataset.
//
// Protected by CRON_SECRET — only Vercel cron should hit this.

import { NextResponse } from 'next/server'
import { syncAllLoansToAirtable } from '@/lib/airtable'

export const maxDuration = 60

// Roughly 1s/loan worst-case (Supabase fetch + Airtable lookup + PATCH).
// 40 leaves ~20s of slack before the Hobby plan kills the function.
const BATCH_SIZE = 40

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
