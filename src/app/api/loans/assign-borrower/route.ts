import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const [{ data: admin }, { data: lo }, { data: lp }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])

  if (!admin && !lo && !lp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, borrowerId } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  // Non-admins must be assigned to this loan
  if (!admin) {
    const { data: loan } = await adminClient
      .from('loans')
      .select('id, loan_officer_id, loan_processor_id, borrower_id')
      .eq('id', loanId)
      .single()
    if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && loan.loan_processor_id === lp.id)

    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // If a borrower is being assigned, verify it exists
  if (borrowerId) {
    const { data: borrower } = await adminClient
      .from('borrowers').select('id, full_name, email').eq('id', borrowerId).single()
    if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })
  }

  const { error } = await adminClient
    .from('loans')
    .update({ borrower_id: borrowerId || null })
    .eq('id', loanId)

  if (error) {
    console.error('assign-borrower error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Audit log
  try {
    const editorName =
      (lo?.full_name as string | undefined) ??
      (lp?.full_name as string | undefined) ??
      (admin ? 'Admin' : null)

    let description: string
    if (borrowerId) {
      const { data: b } = await adminClient
        .from('borrowers').select('full_name, email').eq('id', borrowerId).single()
      description = `Borrower set to ${b?.full_name ?? b?.email ?? borrowerId}${editorName ? ` by ${editorName}` : ''}`
    } else {
      description = `Borrower unassigned${editorName ? ` by ${editorName}` : ''}`
    }
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'borrower_assigned',
      description,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
