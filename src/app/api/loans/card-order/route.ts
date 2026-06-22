// Per-user manual loan-card ordering. POST upserts the slot a staff
// member dragged a card into within a stage; a null position clears
// the pin (reverts that card to default order). This is a personal
// view preference — it does NOT touch loan data or the activity log,
// so it deliberately skips loan_events (and the LP/UW activity clocks).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'

export async function POST(req: NextRequest) {
  // View-As is read-only — don't let an impersonating admin rearrange
  // someone else's (or their own) saved order from a preview.
  const block = await assertNotImpersonating()
  if (block) return block

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  // Light gate: must be a staff member. The ordering only rearranges
  // loans the user can already see, exposes no data, and is keyed per
  // user — so role-on-this-loan verification isn't necessary.
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', user.id).maybeSingle(),
  ])
  if (!admin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { loanId, stage, position } = body as { loanId?: string; stage?: string; position?: number | null }
  if (!loanId || typeof stage !== 'string' || !stage) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Null position → un-pin (card returns to default order).
  if (position === null || position === undefined) {
    const { error } = await adminClient
      .from('loan_card_order')
      .delete()
      .eq('auth_user_id', user.id)
      .eq('loan_id', loanId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const pos = Number(position)
  if (!Number.isFinite(pos) || pos < 0) {
    return NextResponse.json({ error: 'Invalid position' }, { status: 400 })
  }

  const { error } = await adminClient
    .from('loan_card_order')
    .upsert(
      {
        auth_user_id: user.id,
        loan_id: loanId,
        stage,
        position: pos,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'auth_user_id,loan_id' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
