import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getLoanContact } from '@/lib/loan-contact'
import nodemailer from 'nodemailer'
import { PORTAL_URL } from '@/lib/portal-url'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  return admin ? user : null
}

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

async function getLoanWithContacts(adminClient: ReturnType<typeof createAdminClient>, loanId: string) {
  const { data: loan } = await adminClient
    .from('loans')
    .select('property_address, borrowers(full_name, email), loan_officers(full_name, email), loan_processors!loan_processor_id(full_name, email), loan_processor_2:loan_processors!loan_processor_id_2(full_name, email)')
    .eq('id', loanId)
    .single()
  return loan
}

// POST — add a condition
export async function POST(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, title, description, assignedTo, category } = await request.json()
  if (!loanId || !title) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const assigned_to: 'borrower' | 'loan_officer' | 'loan_processor' =
    assignedTo === 'loan_officer' ? 'loan_officer' :
    assignedTo === 'loan_processor' ? 'loan_processor' : 'borrower'

  const validCategories = ['initial', 'underwriting', 'pre_close', 'pre_funding']
  const condition_category = validCategories.includes(category) ? category : null

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('conditions')
    .insert({ loan_id: loanId, title, description: description || null, status: 'Outstanding', assigned_to, category: condition_category })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log event
  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'condition_added',
      description: `Condition added (${assigned_to === 'loan_officer' ? 'Loan Officer' : assigned_to === 'loan_processor' ? 'Loan Processor' : 'Borrower'}): "${title}"`,
    })
  } catch (err) {
    console.error('Event log error (condition_added):', err)
  }

  // Email the right person
  try {
    const loan = await getLoanWithContacts(adminClient, loanId)

    const lo = loan?.loan_officers as unknown as { full_name: string | null; email: string | null } | null
    const lp = (loan as unknown as { loan_processors?: { full_name: string | null; email: string | null } | null })?.loan_processors ?? null
    const lp2 = (loan as unknown as { loan_processor_2?: { full_name: string | null; email: string | null } | null })?.loan_processor_2 ?? null
    const lps = [lp, lp2].filter((p): p is { full_name: string | null; email: string | null } => !!p?.email)

    const staffHtml = (name: string | null, role: string, portalUrl: string) => `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${name ?? 'there'},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        A new condition has been assigned to you (${role}) for <strong>${loan?.property_address ?? 'a loan'}</strong>.
      </p>
      <table style="font-family: Arial, sans-serif; font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
        <tr><td style="padding: 4px 16px 4px 0; color: #666;">Condition</td><td><strong>${title}</strong></td></tr>
        ${description ? `<tr><td style="padding: 4px 16px 4px 0; color: #666;">Details</td><td>${description}</td></tr>` : ''}
      </table>
      <p style="margin-top: 16px;">
        <a href="${portalUrl}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">View in Portal</a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
    `

    if (assigned_to === 'loan_officer' && lo?.email) {
      await getTransporter().sendMail({
        from: `First Equity Funding <${process.env.GMAIL_USER}>`,
        to: lo.email,
        subject: `New condition assigned to you — ${loan?.property_address ?? 'a loan'}`,
        html: staffHtml(lo.full_name, 'Loan Officer', `${PORTAL_URL}/loan-officer`),
      })
    } else if (assigned_to === 'loan_processor' && lps.length > 0) {
      await Promise.all(lps.map(processor => getTransporter().sendMail({
        from: `First Equity Funding <${process.env.GMAIL_USER}>`,
        to: processor.email!,
        subject: `New condition assigned to you — ${loan?.property_address ?? 'a loan'}`,
        html: staffHtml(processor.full_name, 'Loan Processor', `${PORTAL_URL}/loan-processor`),
      })))
    } else if (assigned_to === 'borrower') {
      // Routes to the broker if one is assigned, else the borrower
      const contact = await getLoanContact(loanId)
      if (contact) {
        await getTransporter().sendMail({
          from: `First Equity Funding <${process.env.GMAIL_USER}>`,
          to: contact.email,
          subject: `New condition added — ${loan?.property_address ?? 'a loan'}`,
          html: `
            <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${contact.name ?? 'there'},</p>
            <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
              A new condition has been added to ${contact.kind === 'broker' ? 'a loan file' : 'your loan file'} for <strong>${loan?.property_address ?? 'a property'}</strong>.
            </p>
            <table style="font-family: Arial, sans-serif; font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
              <tr><td style="padding: 4px 16px 4px 0; color: #666;">Condition</td><td><strong>${title}</strong></td></tr>
              ${description ? `<tr><td style="padding: 4px 16px 4px 0; color: #666;">Details</td><td>${description}</td></tr>` : ''}
            </table>
            <p style="margin-top: 16px;">
              <a href="${contact.portalUrl}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">${contact.kind === 'broker' ? 'View in Portal' : 'View My Loan'}</a>
            </p>
            <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
          `,
        })
      }
    }
  } catch (err) {
    console.error('Notification error (condition added):', err)
  }

  return NextResponse.json({ success: true, condition: data })
}

// PATCH — update condition status or assigned_to
export async function PATCH(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { conditionId, status, rejectionReason, assignedTo, category } = await request.json()
  if (!conditionId) return NextResponse.json({ error: 'Missing conditionId' }, { status: 400 })

  const adminClient = createAdminClient()

  const updatePayload: Record<string, string | null> = {}
  if (status) {
    updatePayload.status = status
    if (status === 'Rejected') {
      updatePayload.rejection_reason = rejectionReason ?? null
    }
  }
  if (assignedTo === 'borrower' || assignedTo === 'loan_officer' || assignedTo === 'loan_processor') {
    updatePayload.assigned_to = assignedTo
  }
  const validCategories = ['initial', 'underwriting', 'pre_close', 'pre_funding']
  if (category !== undefined) {
    updatePayload.category = validCategories.includes(category) ? category : null
  }

  // Fetch condition details before updating
  const { data: condition } = await adminClient
    .from('conditions')
    .select('title, loan_id, assigned_to')
    .eq('id', conditionId)
    .single()

  const { error } = await adminClient
    .from('conditions').update(updatePayload).eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log status change event
  if (condition && status) {
    try {
      const desc = status === 'Rejected' && rejectionReason
        ? `"${condition.title}" marked ${status} — ${rejectionReason}`
        : `"${condition.title}" marked ${status}`
      await adminClient.from('loan_events').insert({
        loan_id: condition.loan_id,
        event_type: 'status_changed',
        description: desc,
      })
    } catch (err) {
      console.error('Event log error (status_changed):', err)
    }
  }

  // Only send status-change emails for borrower conditions
  if (condition && status && condition.assigned_to === 'borrower') {
    try {
      await sendBorrowerStatusNotification({ adminClient, condition, status, rejectionReason })
    } catch (err) {
      console.error('Borrower notification error (status change):', err)
    }
  }

  return NextResponse.json({ success: true })
}

async function sendBorrowerStatusNotification({
  adminClient,
  condition,
  status,
  rejectionReason,
}: {
  adminClient: ReturnType<typeof createAdminClient>
  condition: { title: string; loan_id: string }
  status: string
  rejectionReason?: string | null
}) {
  const loan = await getLoanWithContacts(adminClient, condition.loan_id)
  // Routes to the broker if one is assigned, else the borrower
  const contact = await getLoanContact(condition.loan_id)
  if (!contact) return

  const statusMessages: Record<string, string> = {
    Received:  contact.kind === 'broker' ? 'The document has been received and is under review.' : 'Your document has been received and is under review.',
    Satisfied: 'This condition has been satisfied. No further action is needed.',
    Waived:    'This condition has been waived. No further action is needed.',
    Rejected:  contact.kind === 'broker' ? 'The document was not accepted. Please review the reason below and re-upload.' : 'Your document was not accepted. Please review the reason below and re-upload.',
  }
  const statusColors: Record<string, string> = {
    Received:  '#d97706',
    Satisfied: '#2DC653',
    Waived:    '#6b7280',
    Rejected:  '#dc2626',
  }

  const message = statusMessages[status] ?? `The status has been updated to ${status}.`
  const color = statusColors[status] ?? '#333'

  await getTransporter().sendMail({
    from: `First Equity Funding <${process.env.GMAIL_USER}>`,
    to: contact.email,
    subject: `Condition update — ${loan?.property_address ?? 'a loan'}`,
    html: `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${contact.name ?? 'there'},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        A condition on ${contact.kind === 'broker' ? 'a loan' : 'your loan'} for <strong>${loan?.property_address ?? 'a property'}</strong> has been updated.
      </p>
      <table style="font-family: Arial, sans-serif; font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
        <tr><td style="padding: 4px 16px 4px 0; color: #666;">Condition</td><td><strong>${condition.title}</strong></td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #666;">Status</td><td><strong style="color: ${color};">${status}</strong></td></tr>
        ${status === 'Rejected' && rejectionReason ? `<tr><td style="padding: 4px 16px 4px 0; color: #666; vertical-align: top;">Reason</td><td>${rejectionReason}</td></tr>` : ''}
      </table>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333; margin-top: 16px;">${message}</p>
      <p style="margin-top: 16px;">
        <a href="${contact.portalUrl}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">${contact.kind === 'broker' ? 'View in Portal' : 'View My Loan'}</a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
    `,
  })
}

// DELETE — remove a condition
export async function DELETE(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { conditionId } = await request.json()
  if (!conditionId) return NextResponse.json({ error: 'Missing conditionId' }, { status: 400 })

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('conditions').delete().eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
