import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { markDealLost, markDealOpen } from '@/lib/pipedrive'
import type { LoanStatus } from '@/lib/types'

// PATCH /api/loans/status
//   body: { loanId, status: 'active' | 'on_hold' | 'cancelled', reason? }
//
// Cancelling auto-archives the loan and marks the Pipedrive deal as Lost.
// Reactivating from cancelled un-archives and reopens the deal in Pipedrive.
// On Hold is portal-only — no Pipedrive change.
//
// Permissions:
//   Admin: any loan
//   LO / LP / UW: only loans they're assigned to
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

  const { loanId, status, reason } = await req.json() as {
    loanId?: string
    status?: LoanStatus
    reason?: string | null
  }

  if (!loanId || !status) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const validStatuses: LoanStatus[] = ['active', 'on_hold', 'cancelled']
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, pipedrive_deal_id, loan_status, archived, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id, property_address')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  if (!admin) {
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const previousStatus = (loan.loan_status ?? 'active') as LoanStatus
  if (previousStatus === status) {
    return NextResponse.json({ success: true, unchanged: true })
  }

  // Sync Pipedrive FIRST — same pattern as the stage route, fail loudly
  // before we touch the local DB so the two stay aligned.
  try {
    if (status === 'cancelled' && loan.pipedrive_deal_id) {
      await markDealLost(loan.pipedrive_deal_id, reason ?? null)
    } else if (previousStatus === 'cancelled' && status === 'active' && loan.pipedrive_deal_id) {
      await markDealOpen(loan.pipedrive_deal_id)
    }
    // on_hold ↔ active does not touch Pipedrive.
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipedrive update failed'
    console.error('Pipedrive status sync failed:', msg)
    return NextResponse.json({ error: `Could not update Pipedrive: ${msg}` }, { status: 502 })
  }

  // Mirror locally. Cancel auto-archives; reactivate-from-cancel unarchives.
  const updatePayload: Record<string, unknown> = {
    loan_status: status,
    status_changed_at: new Date().toISOString(),
  }
  if (status === 'cancelled') {
    updatePayload.cancellation_reason = reason?.trim() || null
    updatePayload.archived = true
  } else {
    updatePayload.cancellation_reason = null
    if (previousStatus === 'cancelled') updatePayload.archived = false
  }

  const { error } = await adminClient
    .from('loans')
    .update(updatePayload)
    .eq('id', loanId)

  if (error) {
    console.error('Local status update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Audit log
  const editorName =
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    (admin ? 'Admin' : null)

  try {
    let description: string
    if (status === 'cancelled') {
      description = `Loan cancelled${editorName ? ` by ${editorName}` : ''}${reason?.trim() ? ` — reason: ${reason.trim()}` : ''}`
    } else if (status === 'on_hold') {
      description = `Loan placed on hold${editorName ? ` by ${editorName}` : ''}`
    } else {
      // reactivated
      const fromLabel = previousStatus === 'cancelled' ? 'cancelled' : 'on hold'
      description = `Loan reactivated from ${fromLabel}${editorName ? ` by ${editorName}` : ''}`
    }
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'loan_status_changed',
      description,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true, previousStatus, status })
}
