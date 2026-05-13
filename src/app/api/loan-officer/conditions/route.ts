import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import nodemailer from 'nodemailer'
import { PORTAL_URL } from '@/lib/portal-url'

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, title, description, assignedTo, category } = await req.json()
  if (!loanId || !title) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address, borrowers(full_name, email), loan_officers(full_name, email), loan_processors!loan_processor_id(full_name, email)')
    .eq('id', loanId)
    .eq('loan_officer_id', lo.id)
    .single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const assigned_to: 'borrower' | 'loan_officer' | 'loan_processor' =
    assignedTo === 'loan_officer' ? 'loan_officer' :
    assignedTo === 'loan_processor' ? 'loan_processor' : 'borrower'

  const validCategories = ['initial', 'underwriting', 'pre_close', 'pre_funding']
  const condition_category = validCategories.includes(category) ? category : null

  const { data, error } = await adminClient
    .from('conditions')
    .insert({ loan_id: loanId, title, description: description || null, status: 'Outstanding', assigned_to, category: condition_category })
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
    const borrower = (loan.borrowers as unknown as { full_name: string | null; email: string } | null)
    const loanOfficer = (loan.loan_officers as unknown as { full_name: string | null; email: string | null } | null)
    const loanProcessor = (loan.loan_processors as unknown as { full_name: string | null; email: string | null } | null)
    const addr = loan.property_address ?? 'a loan'
    const conditionHtml = `<tr><td style="padding:4px 16px 4px 0;color:#666;">Condition</td><td><strong>${title}</strong></td></tr>${description ? `<tr><td style="padding:4px 16px 4px 0;color:#666;">Details</td><td>${description}</td></tr>` : ''}`

    if (assigned_to === 'borrower' && borrower?.email) {
      await getTransporter().sendMail({
        from: `First Equity Funding <${process.env.GMAIL_USER}>`, to: borrower.email,
        subject: `New condition added — ${addr}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${borrower.full_name ?? 'there'},</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">A new condition has been added to your loan file for <strong>${addr}</strong>.</p><table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">${conditionHtml}</table><p style="margin-top:16px;"><a href="${PORTAL_URL}" style="background-color:#1F5D8F;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">View My Loan</a></p><p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">First Equity Funding Online Portal</p>`,
      })
    } else if (assigned_to === 'loan_officer' && loanOfficer?.email) {
      await getTransporter().sendMail({
        from: `First Equity Funding <${process.env.GMAIL_USER}>`, to: loanOfficer.email,
        subject: `New condition assigned to you — ${addr}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${loanOfficer.full_name ?? 'there'},</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">A new condition has been assigned to you for <strong>${addr}</strong>.</p><table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">${conditionHtml}</table><p style="margin-top:16px;"><a href="${PORTAL_URL}/loan-officer" style="background-color:#1F5D8F;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">View in Portal</a></p><p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">First Equity Funding Online Portal</p>`,
      })
    } else if (assigned_to === 'loan_processor' && loanProcessor?.email) {
      await getTransporter().sendMail({
        from: `First Equity Funding <${process.env.GMAIL_USER}>`, to: loanProcessor.email,
        subject: `New condition assigned to you — ${addr}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${loanProcessor.full_name ?? 'there'},</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">A new condition has been assigned to you for <strong>${addr}</strong>.</p><table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">${conditionHtml}</table><p style="margin-top:16px;"><a href="${PORTAL_URL}/loan-processor" style="background-color:#1F5D8F;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;">View in Portal</a></p><p style="font-family:Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">First Equity Funding Online Portal</p>`,
      })
    }
  } catch (err) { console.error('Notification error:', err) }

  return NextResponse.json({ success: true, condition: data })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { conditionId, status, rejectionReason } = await req.json()

  const allowed = ['Outstanding', 'Received', 'Rejected', 'Waived']
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
