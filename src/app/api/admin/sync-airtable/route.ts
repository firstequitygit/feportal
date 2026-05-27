// Admin-triggered Airtable sync.
//
//   POST {}                  → run the same batch the hourly cron uses
//                              (next 250 stalest loans, oldest-first). Safe
//                              under the 5-min function cap and the standard
//                              way to trigger an on-demand refresh.
//   POST { loanId: '...' }   → sync exactly one loan. Used by the per-loan
//                              Sync to Airtable button.
//
// Admin-only — same auth pattern as the rest of the admin endpoints.
//
// The "sync the entire base in one shot" mode was removed because it can't
// fit inside Vercel's function timeout for the current ~2000-loan dataset.
// The hourly cron covers full-base coverage on a rolling basis.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncAllLoansToAirtable, syncLoanToAirtable } from '@/lib/airtable'
import { assertNotImpersonating } from '@/lib/impersonate'

export const maxDuration = 300

// Mirrors the cron's BATCH_SIZE so on-demand and scheduled runs have the
// same throughput characteristics.
const BATCH_SIZE = 250

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const loanId = typeof body?.loanId === 'string' ? body.loanId : null

  try {
    if (loanId) {
      const result = await syncLoanToAirtable(loanId)
      return NextResponse.json({ ok: true, result })
    }
    const summary = await syncAllLoansToAirtable({
      limit: BATCH_SIZE,
      oldestFirst: true,
    })
    return NextResponse.json({ ok: true, summary, batchSize: BATCH_SIZE })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Airtable sync failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
