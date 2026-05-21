// Daily cron: push Loan Details from the portal → Airtable Deals base.
// Protected by CRON_SECRET — only Vercel cron should hit this.

import { NextResponse } from 'next/server'
import { syncAllLoansToAirtable } from '@/lib/airtable'

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await syncAllLoansToAirtable()
    console.log('Airtable cron sync done:', summary)
    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Airtable cron sync failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
