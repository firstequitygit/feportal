import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH — staff edit a loan's borrower contact details (name / email / phone).
// Admins, loan processors and underwriters can edit any borrower; loan officers
// only borrowers on loans assigned to them. Email is never changed for a
// borrower with a portal login, since email is their sign-in identity.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])
  if (!admin && !lo && !lp && !uw) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, full_name, email, phone } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, borrower_id, loan_officer_id')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (!loan.borrower_id) return NextResponse.json({ error: 'No borrower assigned to this loan' }, { status: 400 })

  // Admins, processors and underwriters can edit any borrower; a loan officer
  // only on loans assigned to them.
  const allowed = !!admin || !!lp || !!uw || (!!lo && loan.loan_officer_id === lo.id)
  if (!allowed) return NextResponse.json({ error: 'You can only edit borrowers on your own loans' }, { status: 403 })

  const { data: current } = await adminClient
    .from('borrowers').select('auth_user_id, email').eq('id', loan.borrower_id).single()
  if (!current) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })

  const updates: Record<string, string | null> = {
    full_name: full_name?.trim() || null,
    phone: phone?.trim() || null,
  }
  if (!current.auth_user_id || email.trim() === current.email) {
    updates.email = email.trim()
  } else {
    return NextResponse.json({
      error: 'This borrower has a portal login — changing their email would break their sign-in. Have them request a password reset or contact an admin.',
    }, { status: 400 })
  }

  const { error } = await adminClient.from('borrowers').update(updates).eq('id', loan.borrower_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    const editorName = admin
      ? 'Admin'
      : (lp?.full_name as string | undefined)
        ?? (uw?.full_name as string | undefined)
        ?? (lo?.full_name as string | undefined)
        ?? null
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'borrower_contact_updated',
      description: `Borrower contact details updated${editorName ? ` by ${editorName}` : ''}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
