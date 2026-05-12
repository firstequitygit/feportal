import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  // Verify the requester is a loan processor
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: lp } = await adminClient
    .from('loan_processors')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()

  if (!lp) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, fullName } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  // Three cases (see /api/invite for details):
  //   1. No row → create auth user + borrower row
  //   2. Row exists with auth_user_id NULL (JotForm intake) → create
  //      auth user and link to existing row
  //   3. Row already linked → fall through to recovery email
  const { data: existing } = await adminClient
    .from('borrowers')
    .select('id, auth_user_id')
    .eq('email', email)
    .maybeSingle()

  let borrowerId = existing?.id ?? null

  if (!existing) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

    const { data: borrower, error: borrowerError } = await adminClient
      .from('borrowers')
      .insert({
        auth_user_id: authUser.user.id,
        email,
        full_name: fullName,
      })
      .select('id')
      .single()
    if (borrowerError) return NextResponse.json({ error: borrowerError.message }, { status: 500 })
    borrowerId = borrower.id
  } else if (!existing.auth_user_id) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

    const { error: linkError } = await adminClient
      .from('borrowers')
      .update({ auth_user_id: authUser.user.id, full_name: fullName ?? undefined })
      .eq('id', existing.id)
    if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 })
  }

  // Generate invite link pointing directly to /auth/welcome
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/welcome`,
    },
  })

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    borrowerId,
    inviteLink: linkData.properties.action_link,
  })
}
