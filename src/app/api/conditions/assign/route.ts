// Reassign a condition to a different role. Shared by admin, LO, LP, UW.
//
// Same access model as /api/conditions/category — any staff with access
// to the parent loan can reassign. Borrowers cannot hit this endpoint
// (the assertNotImpersonating + role check filters them out).
//
// Resetting assigned_to_staff_id to NULL on reassignment is deliberate:
// the staff_id is a pin to a specific person of the previous role, so it
// becomes orphaned the moment you flip the role. Keeping it would leak
// stale data into the badge/name rendering on the condition card.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { sendEmail } from '@/lib/mailer'
import { getLoanContacts } from '@/lib/loan-contact'
import { PORTAL_URL } from '@/lib/portal-url'
import { loanContextBlockHtml } from '@/lib/email-loan-context'

const VALID_ASSIGNEES = ['borrower', 'loan_officer', 'loan_processor', 'underwriter', 'closer'] as const
type AssignedTo = typeof VALID_ASSIGNEES[number]

// Email address for the FE closer. Hardcoded because there's no closers
// role table — Omayra Cartagena (also LP) handles closing for every loan.
// If/when closing gets split across multiple people, swap this for a
// closers table lookup.
const CLOSER_EMAIL = 'ocartagena@fefunding.com'

function roleLabel(a: AssignedTo): string {
  switch (a) {
    case 'borrower':       return 'Borrower'
    case 'loan_officer':   return 'Loan Officer'
    case 'loan_processor': return 'Loan Processor'
    case 'underwriter':    return 'Underwriter'
    case 'closer':         return 'Closer'
  }
}

export async function PATCH(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  // Resolve every staff role the user holds in parallel.
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name, is_ops_manager').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])

  const isAdmin = !!admin
  const isOpsManager = Boolean((lp as { is_ops_manager?: boolean } | null)?.is_ops_manager)
  if (!isAdmin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { conditionId, assignedTo } = await req.json()
  if (!conditionId) return NextResponse.json({ error: 'Missing conditionId' }, { status: 400 })
  if (!VALID_ASSIGNEES.includes(assignedTo)) {
    return NextResponse.json({ error: 'Invalid assignedTo' }, { status: 400 })
  }

  const { data: condition } = await adminClient
    .from('conditions')
    .select('id, loan_id, title, description, assigned_to')
    .eq('id', conditionId)
    .single()
  if (!condition) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Loan-access check for non-admins. Ops manager LPs bypass.
  if (!isAdmin && !isOpsManager) {
    const { data: loan } = await adminClient
      .from('loans')
      .select('loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
      .eq('id', condition.loan_id)
      .single()
    if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // No-op when already on the requested assignee — saves a write + a
  // confusing "reassigned from X to X" event row.
  if (condition.assigned_to === assignedTo) {
    return NextResponse.json({ success: true, noop: true })
  }

  const { error } = await adminClient
    .from('conditions')
    .update({ assigned_to: assignedTo, assigned_to_staff_id: null })
    .eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit log. Use the staff role's full_name for the byline so the log
  // matches the convention from /api/loan-officer/conditions etc.
  const actor =
    (admin ? 'Admin' : null) ??
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    'Staff'
  try {
    await adminClient.from('loan_events').insert({
      loan_id: condition.loan_id,
      event_type: 'condition_reassigned',
      description: `${actor} reassigned "${condition.title}" from ${roleLabel(condition.assigned_to as AssignedTo)} to ${roleLabel(assignedTo)}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  // Notify the new assignee. Failures here are logged but don't fail the
  // request — the reassign already landed and the audit log captures it.
  // Wording differs from condition-creation emails ("reassigned to you"
  // instead of "newly added") so the recipient knows it's a hand-off, not
  // a brand-new condition. For borrower we route through getLoanContacts
  // so brokers + co-borrowers also get the email when applicable.
  try {
    const { data: loanRow } = await adminClient
      .from('loans')
      .select('property_address, borrowers!borrower_id(full_name), loan_officers!loan_officer_id(full_name, email), loan_processors!loan_processor_id(full_name, email), loan_processor_2:loan_processors!loan_processor_id_2(full_name, email)')
      .eq('id', condition.loan_id)
      .single()

    const propertyAddress = loanRow?.property_address ?? 'a loan'
    const fromLabel = roleLabel(condition.assigned_to as AssignedTo)
    const title = condition.title as string
    const description = (condition.description as string | null) ?? null
    const contextBlock = loanContextBlockHtml({
      borrowerName: (loanRow as unknown as { borrowers?: { full_name: string | null } | null })?.borrowers?.full_name ?? null,
      loanOfficerName: (loanRow?.loan_officers as unknown as { full_name: string | null } | null)?.full_name ?? null,
    })

    const staffHtml = (name: string | null, role: string, portalUrl: string) => `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${name ?? 'there'},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        A condition for <strong>${propertyAddress}</strong> has been reassigned to you (${role}) from ${fromLabel}.
      </p>
      ${contextBlock}
      <table style="font-family: Arial, sans-serif; font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
        <tr><td style="padding: 4px 16px 4px 0; color: #666;">Condition</td><td><strong>${title}</strong></td></tr>
        ${description ? `<tr><td style="padding: 4px 16px 4px 0; color: #666;">Details</td><td>${description}</td></tr>` : ''}
      </table>
      <p style="margin-top: 16px;">
        <a href="${portalUrl}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">View in Portal</a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
    `

    if (assignedTo === 'loan_officer') {
      const lo = loanRow?.loan_officers as unknown as { full_name: string | null; email: string | null } | null
      if (lo?.email) {
        await sendEmail({
          to: lo.email,
          subject: `Condition reassigned to you — ${propertyAddress}`,
          html: staffHtml(lo.full_name, 'Loan Officer', `${PORTAL_URL}/loan-officer`),
        })
      }
    } else if (assignedTo === 'loan_processor') {
      const lp = (loanRow as unknown as { loan_processors?: { full_name: string | null; email: string | null } | null })?.loan_processors ?? null
      const lp2 = (loanRow as unknown as { loan_processor_2?: { full_name: string | null; email: string | null } | null })?.loan_processor_2 ?? null
      const lps = [lp, lp2].filter((p): p is { full_name: string | null; email: string | null } => !!p?.email)
      await Promise.all(lps.map(processor => sendEmail({
        to: processor.email!,
        subject: `Condition reassigned to you — ${propertyAddress}`,
        html: staffHtml(processor.full_name, 'Loan Processor', `${PORTAL_URL}/loan-processor`),
      })))
    } else if (assignedTo === 'underwriter') {
      // Underwriters aren't joined on the loanRow select above — fetch separately.
      const { data: uwRow } = await adminClient
        .from('loans')
        .select('underwriters!underwriter_id(full_name, email)')
        .eq('id', condition.loan_id)
        .single()
      const uw = (uwRow as unknown as { underwriters?: { full_name: string | null; email: string | null } | null })?.underwriters ?? null
      if (uw?.email) {
        await sendEmail({
          to: uw.email,
          subject: `Condition reassigned to you — ${propertyAddress}`,
          html: staffHtml(uw.full_name, 'Underwriter', `${PORTAL_URL}/underwriter`),
        })
      }
    } else if (assignedTo === 'closer') {
      // Closer = Omayra. She's an LP, so her loan-processor portal link
      // is the right CTA target.
      const { data: closer } = await adminClient
        .from('loan_processors')
        .select('full_name, email')
        .eq('email', CLOSER_EMAIL)
        .maybeSingle()
      if (closer?.email) {
        await sendEmail({
          to: closer.email,
          subject: `Condition reassigned to you — ${propertyAddress}`,
          html: staffHtml(closer.full_name, 'Closer', `${PORTAL_URL}/loan-processor`),
        })
      }
    } else if (assignedTo === 'borrower') {
      // Same routing as condition-creation: broker if assigned, else every
      // borrower slot on the loan (primary + co-borrowers).
      const contacts = await getLoanContacts(condition.loan_id as string)
      if (contacts.length > 0) {
        const greeting = contacts.length === 1 ? (contacts[0].name ?? 'there') : 'there'
        const kind = contacts[0].kind
        const portalUrl = contacts[0].portalUrl
        await sendEmail({
          to: contacts.map(c => c.email).join(', '),
          subject: `Condition reassigned — ${propertyAddress}`,
          html: `
            <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${greeting},</p>
            <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
              A condition on ${kind === 'broker' ? 'a loan file' : 'your loan file'} for <strong>${propertyAddress}</strong> has been reassigned to ${kind === 'broker' ? 'the broker' : 'you'} from ${fromLabel}.
            </p>
            ${contextBlock}
            <table style="font-family: Arial, sans-serif; font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
              <tr><td style="padding: 4px 16px 4px 0; color: #666;">Condition</td><td><strong>${title}</strong></td></tr>
              ${description ? `<tr><td style="padding: 4px 16px 4px 0; color: #666;">Details</td><td>${description}</td></tr>` : ''}
            </table>
            <p style="margin-top: 16px;">
              <a href="${portalUrl}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">${kind === 'broker' ? 'View in Portal' : 'View My Loan'}</a>
            </p>
            <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
          `,
        })
      }
    }
  } catch (err) {
    console.error('Notification error (condition reassigned):', err)
  }

  return NextResponse.json({ success: true })
}
