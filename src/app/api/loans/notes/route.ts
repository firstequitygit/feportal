import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface StaffContext {
  userEmail: string | null
  isAdmin: boolean
  loId: string | null
  lpId: string | null
  uwId: string | null
}

async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const adminClient = createAdminClient()
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])

  if (!admin && !lo && !lp && !uw) return null

  // Prefer the staff role's full_name for the byline, fall back to email
  const fullName =
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    null

  return {
    userEmail: fullName ?? user.email ?? null,
    isAdmin: !!admin,
    loId: lo?.id ?? null,
    lpId: lp?.id ?? null,
    uwId: uw?.id ?? null,
  }
}

async function verifyLoanAccess(loanId: string, ctx: StaffContext): Promise<boolean> {
  if (ctx.isAdmin) return true
  const adminClient = createAdminClient()
  const { data: loan } = await adminClient
    .from('loans')
    .select('loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
    .eq('id', loanId)
    .single()
  if (!loan) return false
  return Boolean(
    (ctx.loId && loan.loan_officer_id === ctx.loId) ||
    (ctx.lpId && (loan.loan_processor_id === ctx.lpId || loan.loan_processor_id_2 === ctx.lpId)) ||
    (ctx.uwId && loan.underwriter_id === ctx.uwId),
  )
}

export async function POST(req: NextRequest) {
  const ctx = await getStaffContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, content } = await req.json()
  if (!loanId || !content?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  if (!await verifyLoanAccess(loanId, ctx)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('loan_notes')
    .insert({
      loan_id: loanId,
      content: content.trim(),
      created_by: ctx.userEmail ?? 'Staff',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, note: data })
}

export async function DELETE(req: NextRequest) {
  const ctx = await getStaffContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { noteId } = await req.json()
  if (!noteId) return NextResponse.json({ error: 'Missing noteId' }, { status: 400 })

  const adminClient = createAdminClient()
  const { data: note } = await adminClient
    .from('loan_notes')
    .select('loan_id')
    .eq('id', noteId)
    .single()
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!await verifyLoanAccess(note.loan_id, ctx)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminClient.from('loan_notes').delete().eq('id', noteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
