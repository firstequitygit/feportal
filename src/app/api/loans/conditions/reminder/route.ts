// POST /api/loans/conditions/reminder
//
// Manual "Send Reminder" trigger from the loan detail header. Sends
// an outstanding-conditions reminder to whoever should receive it
// for this loan — broker(s) if a broker is on the loan, otherwise
// the active borrower slots. Caller doesn't choose; the helper
// enforces the broker-wins rule so we can't accidentally email
// borrowers on a brokered loan.
//
// Always re-sends on click — no 3-day gate (that gate is the
// auto-cron's job). A manual send still updates the matching
// last_*_reminder_at timestamp so the cron's next-fire clock
// resets for that party.
//
// Body: { loanId: string }
//
// Auth: admin / LO / LP / UW. Non-admin staff must be assigned to
// the loan (ops-manager LPs bypass, matching notify-underwriter).
// Borrowers + brokers can never trigger their own reminder.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { sendConditionReminderEmail } from '@/lib/condition-reminder-email'

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name, is_ops_manager').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])

  const isAdmin = !!admin
  const isOpsManager = Boolean((lp as { is_ops_manager?: boolean } | null)?.is_ops_manager)
  if (!isAdmin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as { loanId?: string } | null
  const loanId = body?.loanId
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  // Non-admin access check — same shape as notify-underwriter.
  if (!isAdmin && !isOpsManager) {
    const { data: loanAccess } = await adminClient
      .from('loans')
      .select('loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
      .eq('id', loanId)
      .single()
    if (!loanAccess) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
    const hasAccess =
      (lo && loanAccess.loan_officer_id === lo.id) ||
      (lp && (loanAccess.loan_processor_id === lp.id || loanAccess.loan_processor_id_2 === lp.id)) ||
      (uw && loanAccess.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const author =
    (isAdmin ? (admin?.full_name as string | null) ?? 'Admin' : null) ??
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    'Staff'

  const result = await sendConditionReminderEmail(loanId)

  // Stamp the matching timestamp + write the audit row only when the
  // email actually went out. A skip (no recipients, no outstanding,
  // loan inactive) shouldn't reset the cron's 3-day clock.
  if (result.sent > 0 && result.party) {
    const column = result.party === 'borrower' ? 'last_borrower_reminder_at' : 'last_broker_reminder_at'
    await adminClient
      .from('loans')
      .update({ [column]: new Date().toISOString() })
      .eq('id', loanId)

    try {
      await adminClient.from('loan_events').insert({
        loan_id: loanId,
        event_type: 'condition_reminder_sent',
        description: `${author} sent a ${result.party} reminder (${result.sent} recipient${result.sent !== 1 ? 's' : ''}, ${result.conditionsCount} outstanding item${result.conditionsCount !== 1 ? 's' : ''})`,
      })
    } catch (err) {
      console.error('condition_reminder_sent event log error:', err)
    }
  }

  return NextResponse.json({ success: true, result })
}
