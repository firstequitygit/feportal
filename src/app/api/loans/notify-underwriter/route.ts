// POST /api/loans/notify-underwriter
//
// Sends a "please review" email to the underwriter assigned to a loan.
// Triggered by LO / LP / admin from the loan detail page when they've
// updated the file and need eyes on it. Optional free-text note is
// included verbatim in the email body so the recipient knows what
// changed.
//
// Refuses when no underwriter is assigned — the UI button is disabled
// in that case but the route enforces it server-side too.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { sendEmail } from '@/lib/mailer'
import { PORTAL_URL } from '@/lib/portal-url'

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  // Any staff role — admin, LO, LP, UW — can trigger the notification.
  // Non-admins must be assigned to the loan (ops-manager LPs bypass,
  // matching the rest of the LP routes).
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

  const { loanId, message } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })
  const trimmedMessage = typeof message === 'string' ? message.trim().slice(0, 2000) : ''

  // Fetch loan + assigned UW in one shot.
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address, loan_number, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id, underwriters!underwriter_id(full_name, email)')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  // Non-admin access check.
  if (!isAdmin && !isOpsManager) {
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const underwriter = loan.underwriters as unknown as { full_name: string | null; email: string | null } | null
  if (!underwriter?.email) {
    return NextResponse.json(
      { error: 'No underwriter assigned to this loan' },
      { status: 400 },
    )
  }

  // Author name for the email + audit log. Same precedence as the
  // condition routes — admin first, then staff role full_name.
  const author =
    (isAdmin ? (admin?.full_name as string | null) ?? 'Admin' : null) ??
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    'A teammate'
  const authorRole =
    isAdmin ? 'Admin' :
    lo ? 'Loan Officer' :
    lp ? 'Loan Processor' :
    uw ? 'Underwriter' : 'Staff'

  const propertyAddress = loan.property_address ?? 'a loan'

  await sendEmail({
    to: underwriter.email,
    subject: `Review requested — ${propertyAddress}`,
    html: `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${underwriter.full_name ?? 'there'},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        <strong>${author}</strong> (${authorRole}) is asking you to review <strong>${propertyAddress}</strong>.
      </p>
      ${trimmedMessage ? `
        <blockquote style="font-family: Arial, sans-serif; font-size: 14px; color: #555; border-left: 3px solid #1F5D8F; padding: 8px 12px; margin: 12px 0; background: #f8fafc; white-space: pre-wrap;">
          ${escapeHtml(trimmedMessage)}
        </blockquote>
      ` : ''}
      <p style="margin-top: 16px;">
        <a href="${PORTAL_URL}/underwriter/loans/${loan.id}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">Open in Portal</a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
    `,
  })

  // Audit log so the activity feed shows the prod.
  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'underwriter_notified',
      description: trimmedMessage
        ? `${author} requested UW review${trimmedMessage ? `: ${trimmedMessage.slice(0, 200)}` : ''}`
        : `${author} requested UW review`,
    })
  } catch (err) {
    console.error('Notify-UW event log error:', err)
  }

  return NextResponse.json({ success: true })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
