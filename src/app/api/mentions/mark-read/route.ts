// Mark mentions as read.
//
// POST { mentionIds: string[] | 'all' }
//   - array → mark those rows read (only ones belonging to the caller)
//   - 'all' → mark every unread mention for the caller as read
//
// Borrowers / brokers can't be mentioned today, so this endpoint is
// staff-only.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  // Figure out which role row the caller corresponds to so we only
  // touch their own mentions.
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', user.id).single(),
  ])
  if (!admin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { mentionIds } = await req.json().catch(() => ({}))
  const now = new Date().toISOString()

  // OR clause over every (kind, id) pair the caller might own. Most
  // people hold a single staff row, but a couple of users have both an
  // admin_users row AND an LO/LP/UW row — those each have their own
  // mentions stream.
  const orClauses: string[] = []
  if (admin) orClauses.push(`and(mentioned_user_kind.eq.admin,mentioned_user_id.eq.${admin.id})`)
  if (lo)    orClauses.push(`and(mentioned_user_kind.eq.loan_officer,mentioned_user_id.eq.${lo.id})`)
  if (lp)    orClauses.push(`and(mentioned_user_kind.eq.loan_processor,mentioned_user_id.eq.${lp.id})`)
  if (uw)    orClauses.push(`and(mentioned_user_kind.eq.underwriter,mentioned_user_id.eq.${uw.id})`)

  let q = adminClient.from('mentions').update({ read_at: now }).or(orClauses.join(','))
  if (Array.isArray(mentionIds) && mentionIds.length > 0) {
    q = q.in('id', mentionIds)
  } else if (mentionIds !== 'all') {
    return NextResponse.json({ error: 'mentionIds must be an array or "all"' }, { status: 400 })
  }

  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
