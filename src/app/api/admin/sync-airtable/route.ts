// Airtable sync trigger.
//
//   POST {}                  → run the same batch the hourly cron uses
//                              (next 250 stalest loans, oldest-first).
//                              Admin-only.
//   POST { loanId: '...' }   → sync exactly one loan. Available to admin
//                              + any LO/LP/UW assigned to the loan. Used by
//                              the per-loan Sync to Airtable button on the
//                              loan detail pages.
//
// Path still says /api/admin/ for historical reasons (was admin-only
// originally). Single-loan mode was relaxed so LO/LP/UW can force an
// immediate sync after editing a field instead of waiting on the
// hourly cron rotation.
//
// "Sync the entire base in one shot" mode was removed because it can't
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

  // Resolve every staff role the user holds in parallel — admins can do
  // everything; LO/LP/UW can only sync loans they're assigned to (or, for
  // ops manager LPs, any loan).
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, is_ops_manager').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', user.id).single(),
  ])

  const isAdmin = !!admin
  const isOpsManager = Boolean((lp as { is_ops_manager?: boolean } | null)?.is_ops_manager)
  if (!isAdmin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const loanId = typeof body?.loanId === 'string' ? body.loanId : null

  // Batch sync stays admin-only. ~250 loans × ~1s each is a heavy operation
  // and there's no per-loan access scope to enforce on it.
  if (!loanId && !isAdmin) {
    return NextResponse.json({ error: 'Batch sync is admin-only' }, { status: 403 })
  }

  // Single-loan sync: verify the non-admin caller is actually assigned to
  // the loan. Ops managers (currently Omayra) bypass — same exception used
  // across LP routes.
  if (loanId && !isAdmin && !isOpsManager) {
    const { data: loanRow } = await adminClient
      .from('loans')
      .select('loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
      .eq('id', loanId)
      .single()
    if (!loanRow) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
    const hasAccess =
      (lo && loanRow.loan_officer_id === lo.id) ||
      (lp && (loanRow.loan_processor_id === lp.id || loanRow.loan_processor_id_2 === lp.id)) ||
      (uw && loanRow.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
    // Defensive: anything could land here. String(plainObject) gives
    // "[object Object]" which is the bug we just chased — go through
    // the same coercion we expect on the client.
    let msg: string
    if (e instanceof Error) msg = e.message
    else if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>
      msg = typeof o.message === 'string' ? o.message : JSON.stringify(e).slice(0, 300)
    } else msg = String(e)
    console.error('Airtable sync failed:', msg, e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
