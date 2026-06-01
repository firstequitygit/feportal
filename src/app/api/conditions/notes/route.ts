// Staff notes on a specific condition. Visible to / editable by admins
// and any LO / LP / UW assigned to the underlying loan. Borrowers,
// brokers, and broker processors never reach this endpoint.
//
// Mirrors /api/loans/notes — same access model, same byline derivation.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { processMentions } from '@/lib/process-mentions'

interface StaffContext {
  userEmail: string | null
  isAdmin: boolean
  loId: string | null
  lpId: string | null
  isOpsManager: boolean
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
    adminClient.from('loan_processors').select('id, full_name, is_ops_manager').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])

  if (!admin && !lo && !lp && !uw) return null

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
    isOpsManager: Boolean((lp as { is_ops_manager?: boolean } | null)?.is_ops_manager),
    uwId: uw?.id ?? null,
  }
}

async function verifyLoanAccess(loanId: string, ctx: StaffContext): Promise<boolean> {
  if (ctx.isAdmin) return true
  if (ctx.isOpsManager) return true
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

// Resolve the condition → loan so we can run the loan-level access check.
async function loanIdForCondition(conditionId: string): Promise<string | null> {
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .from('conditions').select('loan_id').eq('id', conditionId).single()
  return data?.loan_id ?? null
}

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const ctx = await getStaffContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { conditionId, content, mentions } = await req.json()
  if (!conditionId || !content?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const loanId = await loanIdForCondition(conditionId)
  if (!loanId) return NextResponse.json({ error: 'Condition not found' }, { status: 404 })
  if (!await verifyLoanAccess(loanId, ctx)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('condition_notes')
    .insert({
      condition_id: conditionId,
      content: content.trim(),
      created_by: ctx.userEmail ?? 'Staff',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (Array.isArray(mentions) && mentions.length > 0 && data?.id) {
    try {
      await processMentions({
        adminClient,
        authorName: ctx.userEmail ?? 'Staff',
        loanId,
        conditionId,
        sourceKind: 'condition_note',
        sourceId: data.id,
        text: content,
        mentions,
      })
    } catch (err) { console.error('processMentions failed:', err) }
  }

  return NextResponse.json({ success: true, note: data })
}

export async function DELETE(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const ctx = await getStaffContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { noteId } = await req.json()
  if (!noteId) return NextResponse.json({ error: 'Missing noteId' }, { status: 400 })

  const adminClient = createAdminClient()
  const { data: note } = await adminClient
    .from('condition_notes')
    .select('condition_id')
    .eq('id', noteId)
    .single()
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const loanId = await loanIdForCondition(note.condition_id)
  if (!loanId || !await verifyLoanAccess(loanId, ctx)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminClient.from('condition_notes').delete().eq('id', noteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
