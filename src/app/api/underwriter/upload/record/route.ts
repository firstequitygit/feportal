import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import nodemailer from 'nodemailer'
import { PORTAL_URL } from '@/lib/portal-url'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: uw } = await adminClient
    .from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!uw) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, conditionId, fileName, fileSize, path } = await req.json()
  if (!loanId || !conditionId || !fileName || !path) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address, loan_processors!loan_processor_id(full_name, email)')
    .eq('id', loanId)
    .eq('underwriter_id', uw.id)
    .single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: condition } = await adminClient
    .from('conditions').select('title').eq('id', conditionId).single()

  const { error } = await adminClient.from('documents').insert({
    loan_id: loanId,
    condition_id: conditionId,
    file_name: fileName,
    file_path: path,
    file_size: fileSize ?? null,
  })

  if (error) return NextResponse.json({ error: 'Could not save document: ' + error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'document_uploaded',
      description: `Underwriter ${uw.full_name} uploaded document for "${condition?.title ?? 'condition'}": ${fileName}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  // Generate action token for LP to update condition from email
  let actionToken: string | null = null
  try {
    const { data: tokenRow } = await adminClient
      .from('condition_action_tokens')
      .insert({ condition_id: conditionId, loan_id: loanId })
      .select('token').single()
    actionToken = tokenRow?.token ?? null
  } catch (err) { console.error('Token generation error:', err) }

  let fileBuffer: Buffer | null = null
  try {
    const { data: fileData } = await adminClient.storage.from('documents').download(path)
    if (fileData) fileBuffer = Buffer.from(await fileData.arrayBuffer())
  } catch (err) { console.error('File download error:', err) }

  // Notify the assigned loan processor
  const lp = loan.loan_processors as unknown as { full_name: string; email: string | null } | null
  const toEmail = lp?.email ?? 'fefprocessing@gmail.com'
  const toName  = lp?.full_name ?? 'Loan Processor'

  try {
    await sendNotification({
      toEmail, toName,
      uploaderName: uw.full_name,
      propertyAddress: loan.property_address ?? 'Unknown property',
      conditionTitle: condition?.title ?? 'Unknown condition',
      fileName, fileBuffer, actionToken,
    })
  } catch (err) { console.error('Email notification error:', err) }

  return NextResponse.json({ success: true })
}

const BASE_URL = PORTAL_URL

function actionButton(label: string, action: string, token: string, bgColor: string) {
  const url = `${BASE_URL}/api/conditions/action?token=${token}&action=${action}`
  return `<a href="${url}" style="display:inline-block;padding:10px 20px;background:${bgColor};color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;font-weight:600;margin-right:8px;">${label}</a>`
}

async function sendNotification({ toEmail, toName, uploaderName, propertyAddress, conditionTitle, fileName, fileBuffer, actionToken }: {
  toEmail: string; toName: string; uploaderName: string
  propertyAddress: string; conditionTitle: string; fileName: string
  fileBuffer: Buffer | null; actionToken: string | null
}) {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) { console.warn('Gmail credentials not configured'); return }

  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })

  const actionButtons = actionToken
    ? `<div style="margin-top:24px;"><p style="font-family:Arial,sans-serif;font-size:13px;color:#555;margin:0 0 12px;">Update this condition directly from your email:</p><div>${actionButton('📥 Mark Received', 'received', actionToken, '#2563eb')}${actionButton('✅ Mark Satisfied', 'satisfied', actionToken, '#16a34a')}${actionButton('❌ Mark Rejected', 'rejected', actionToken, '#dc2626')}</div><p style="font-family:Arial,sans-serif;font-size:11px;color:#aaa;margin-top:12px;">These links expire in 7 days.</p></div>`
    : ''

  await transporter.sendMail({
    from: `First Equity Funding <${gmailUser}>`,
    to: toEmail,
    subject: `Document uploaded — ${propertyAddress}`,
    html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">Hi ${toName},<br/><br/><strong>${uploaderName}</strong> (Underwriter) has uploaded a document to the First Equity Funding portal.</p><table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;"><tr><td style="padding:4px 16px 4px 0;color:#666;">Property</td><td><strong>${propertyAddress}</strong></td></tr><tr><td style="padding:4px 16px 4px 0;color:#666;">Condition</td><td><strong>${conditionTitle}</strong></td></tr><tr><td style="padding:4px 16px 4px 0;color:#666;">File</td><td><strong>${fileName}</strong></td></tr></table>${actionButtons}<p style="font-family:Arial,sans-serif;font-size:13px;color:#888;margin-top:24px;">Or log in to the <a href="${BASE_URL}/loan-processor" style="color:#1F5D8F;">processor portal</a> to review.</p>`,
    attachments: fileBuffer ? [{ filename: fileName, content: fileBuffer }] : [],
  })
}
