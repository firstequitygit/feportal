import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH — Loan Officers can edit borrower contact details (name / email /
// phone), but only for borrowers who are on at least one loan they own.
// Email is never changed for a borrower with a portal login (would break
// their sign-in); same rule the sync uses.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: lo } = await adminClient
    .from('loan_officers').select('id').eq('auth_user_id', user.id).single()
  if (!lo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, full_name, email, phone } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  // Permission: is this borrower on any of this LO's loans?
  const { data: loanHit } = await adminClient
    .from('loans')
    .select('id')
    .eq('loan_officer_id', lo.id)
    .or(`borrower_id.eq.${id},borrower_id_2.eq.${id},borrower_id_3.eq.${id},borrower_id_4.eq.${id}`)
    .limit(1)
    .maybeSingle()
  if (!loanHit) return NextResponse.json({ error: 'Borrower is not on any of your loans' }, { status: 403 })

  // Pull current borrower to honor the auth_user_id email-protection rule
  const { data: current } = await adminClient
    .from('borrowers').select('auth_user_id, email').eq('id', id).single()
  if (!current) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })

  const updates: Record<string, string | null> = {
    full_name: full_name ?? null,
    phone: phone ?? null,
  }
  // Only update email when there's no portal login or the value hasn't
  // changed — otherwise we'd silently break their sign-in.
  if (!current.auth_user_id || email.trim() === current.email) {
    updates.email = email.trim()
  } else if (email.trim() !== current.email) {
    return NextResponse.json({
      error: 'This borrower has a portal login — changing their email would break their sign-in. Have them request a password reset or contact an admin.',
    }, { status: 400 })
  }

  const { error } = await adminClient.from('borrowers').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
