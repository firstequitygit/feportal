import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanContacts } from '@/lib/loan-contact'
import { PORTAL_URL } from '@/lib/portal-url'
import { sendEmail } from '@/lib/mailer'
import { validateStaffIdExists, getStaffContact } from '@/lib/loan-staff'

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, title, description, assignedTo, assignedToStaffId, category } = await req.json()
  if (!loanId || !title) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id, borrowers!borrower_id(full_name, email), loan_officers(full_name, email), loan_processors!loan_processor_id(full_name, email), loan_processor_2:loan_processors!loan_processor_id_2(full_name, email)')
    .eq('id', loanId)
    .eq('loan_officer_id', lo.id)
    .single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Accept all 4 roles so the "Other" UI path can pin to any staff member.
  const assigned_to: 'borrower' | 'loan_officer' | 'loan_processor' | 'underwriter' =
    assignedTo === 'loan_officer'   ? 'loan_officer'   :
    assignedTo === 'loan_processor' ? 'loan_processor' :
    assignedTo === 'underwriter'    ? 'underwriter'    :
                                       'borrower'

  const assigned_to_staff_id = await validateStaffIdExists(adminClient, assigned_to, assignedToStaffId)

  const validCategories = ['initial', 'underwriting', 'pre_close', 'pre_funding']
  const condition_category = validCategories.includes(category) ? category : null

  const { data, error } = await adminClient
    .from('conditions')
    .insert({
      loan_id: loanId,
      title,
      description: description || null,
      status: 'Outstanding',
      assigned_to,
      assigned_to_staff_id,
      category: condition_category,
    })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'condition_added',
      description: `Loan officer ${lo.full_name} added condition (${assigned_to === 'loan_officer' ? 'Loan Officer' : assigned_to === 'loan_processor' ? 'Loan Processor' : 'Borrower'}): "${title}"`,
    })
  } catch (err) { console.error('Event log error:', err) }

  // Notify the assigned party
  try {
    const loanOfficer = (loan.loan_officers as unknown as { full_name: string | null; email: string | null } | null)
    const loanProcessor = (loan.loan_processors as unknown as { full_name: string | null; email: string | null } | null)
    const loanProcessor2 = ((loan as unknown as { loan_processor_2: { full_name: string | null; email: string | null } | null }).loan_processor_2)
    const allLPs = [loanProcessor, loanProcessor2].filter((p): p is { full_name: string | null; email: string | null } => !!p?.email)
    const addr = loan.property_address ?? 'a loan'
    const conditionHtml = `<tr><td style="padding:4px 16px 4px 0;color:#666;">Condition</td><td><strong>${title}</strong></td></tr>${description ? `<tr><td style="padding:4px 16px 4px 0;color:#666;">Details</td><td>${description}</td></tr>` : ''}`

    // "Other" UI path: pinned to a specific staff member regardless of role.
    // Bypasses the role-wide fan-out below.
    if (assigned_to !== 'borrower' && assigned_to_staff_id) {
      const pinned = await getStaffContact(adminClient, assigned_to, assigned_to_staff_id)
      if (pinned?.email) {
        const portalPath =
          assigned_to === 'loan_officer'   ? '/loan-officer'   :
          assigned_to === 'loan_processor' ? '/loan-processor' :
                                              '/underwriter'
        await sendEmail({
          to: pinned.email,
          subject: `New condition assigned to you — ${addr}`,
          html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${pinned.full_name ?? 'there'},</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">A new condition has been assigned to you for <strong>${addr}</strong>.</p><table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">${conditionHtml}</table><p style="margin-top:16px;"><a href="${PORTAL_URL}${portalPath}" style="background-color:#1F5D8F;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">View in Portal</a></p><p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">First Equity Funding Online Portal</p>`,
        })
      }
    } else if (assigned_to === 'borrower') {
      // Routes to the broker if one is assigned, else every borrower slot
      const contacts = await getLoanContacts(loanId)
      if (contacts.length > 0) {
        const greeting = contacts.length === 1 ? (contacts[0].name ?? 'there') : 'there'
        const kind = contacts[0].kind
        const portalUrl = contacts[0].portalUrl
        await sendEmail({
          to: contacts.map(c => c.email).join(', '),
          subject: `New condition added — ${addr}`,
          html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${greeting},</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">A new condition has been added to ${kind === 'broker' ? 'a loan file' : 'your loan file'} for <strong>${addr}</strong>.</p><table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">${conditionHtml}</table><p style="margin-top:16px;"><a href="${portalUrl}" style="background-color:#1F5D8F;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">${kind === 'broker' ? 'View in Portal' : 'View My Loan'}</a></p><p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">First Equity Funding Online Portal</p>`,
        })
      }
    } else if (assigned_to === 'loan_officer' && loanOfficer?.email) {
      await sendEmail({
        to: loanOfficer.email,
        subject: `New condition assigned to you — ${addr}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${loanOfficer.full_name ?? 'there'},</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">A new condition has been assigned to you for <strong>${addr}</strong>.</p><table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">${conditionHtml}</table><p style="margin-top:16px;"><a href="${PORTAL_URL}/loan-officer" style="background-color:#1F5D8F;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">View in Portal</a></p><p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">First Equity Funding Online Portal</p>`,
      })
    } else if (assigned_to === 'loan_processor' && allLPs.length > 0) {
      // Role-wide fan-out to every LP on the loan.
      await Promise.all(allLPs.map(p => sendEmail({
        to: p.email!,
        subject: `New condition assigned to you — ${addr}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${p.full_name ?? 'there'},</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">A new condition has been assigned to you for <strong>${addr}</strong>.</p><table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">${conditionHtml}</table><p style="margin-top:16px;"><a href="${PORTAL_URL}/loan-processor" style="background-color:#1F5D8F;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">View in Portal</a></p><p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">First Equity Funding Online Portal</p>`,
      })))
    }
  } catch (err) { console.error('Notification error:', err) }

  return NextResponse.json({ success: true, condition: data })
}

export async function PUT(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { conditionId, status, rejectionReason } = await req.json()

  // 'Satisfied' is normally the underwriter's call, but LO can do it after
  // confirming the warning in the UI.
  const allowed = ['Outstanding', 'Received', 'Rejected', 'Waived', 'Satisfied']
  if (!conditionId || !allowed.includes(status))
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { data: condition } = await adminClient
    .from('conditions').select('id, loan_id, title').eq('id', conditionId).single()
  if (!condition) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: loan } = await adminClient
    .from('loans').select('id').eq('id', condition.loan_id).eq('loan_officer_id', lo.id).single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const updatePayload: Record<string, unknown> = { status }
  if (status === 'Rejected') updatePayload.rejection_reason = rejectionReason?.trim() || null
  else updatePayload.rejection_reason = null

  const { error } = await adminClient
    .from('conditions').update(updatePayload).eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: condition.loan_id,
      event_type: 'condition_status_changed',
      description: `Loan officer ${lo.full_name} marked "${condition.title}" as ${status}${status === 'Rejected' && rejectionReason?.trim() ? `: ${rejectionReason.trim()}` : ''}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { conditionId, response } = await req.json()
  if (!conditionId || !response?.trim()) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Verify the condition belongs to a loan assigned to this LO
  const { data: condition } = await adminClient
    .from('conditions').select('id, loan_id, title').eq('id', conditionId).single()
  if (!condition) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: loan } = await adminClient
    .from('loans').select('id').eq('id', condition.loan_id).eq('loan_officer_id', lo.id).single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await adminClient
    .from('conditions')
    .update({ response: response.trim(), status: 'Received' })
    .eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: condition.loan_id,
      event_type: 'condition_response',
      description: `Loan officer ${lo.full_name} responded to "${condition.title}": ${response.trim()}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
