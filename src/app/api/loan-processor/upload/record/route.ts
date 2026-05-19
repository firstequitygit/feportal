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

  const { data: lp } = await adminClient
    .from('loan_processors').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, conditionId, fileName, fileSize, path } = await req.json()
  if (!loanId || !conditionId || !fileName || !path) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Fetch loan (verify ownership) + LO contact info in one query
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address, loan_officers(full_name, email)')
    .eq('id', loanId)
    .or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`)
    .single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: condition } = await adminClient
    .from('conditions').select('title, status').eq('id', conditionId).single()

  const { error } = await adminClient.from('documents').insert({
    loan_id: loanId,
    condition_id: conditionId,
    file_name: fileName,
    file_path: path,
    file_size: fileSize ?? null,
  })

  if (error) return NextResponse.json({ error: 'Could not save document: ' + error.message }, { status: 500 })

  // Flip the condition into the underwriter review queue when it was outstanding
  if (condition?.status === 'Outstanding' || condition?.status === 'Rejected') {
    await adminClient.from('conditions').update({ status: 'Received' }).eq('id', conditionId)
  }

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'document_uploaded',
      description: `Loan processor ${lp.full_name} uploaded document for "${condition?.title ?? 'condition'}": ${fileName}`,
    })
  } catch (err) {
    console.error('Event log error:', err)
  }

  // Download the file to attach to the email
  let fileBuffer: Buffer | null = null
  try {
    const { data: fileData } = await adminClient.storage.from('documents').download(path)
    if (fileData) fileBuffer = Buffer.from(await fileData.arrayBuffer())
  } catch (err) {
    console.error('File download error:', err)
  }

  // Notify the assigned loan officer
  const lo = loan.loan_officers as unknown as { full_name: string; email: string | null } | null
  if (lo?.email) {
    try {
      await sendNotification({
        toEmail: lo.email,
        toName: lo.full_name,
        uploaderName: lp.full_name,
        propertyAddress: loan.property_address ?? 'Unknown property',
        conditionTitle: condition?.title ?? 'Unknown condition',
        fileName,
        fileBuffer,
      })
    } catch (err) {
      console.error('Email notification error:', err)
    }
  }

  return NextResponse.json({ success: true })
}

async function sendNotification({
  toEmail,
  toName,
  uploaderName,
  propertyAddress,
  conditionTitle,
  fileName,
  fileBuffer,
}: {
  toEmail: string
  toName: string
  uploaderName: string
  propertyAddress: string
  conditionTitle: string
  fileName: string
  fileBuffer: Buffer | null
}) {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) {
    console.warn('Gmail credentials not configured')
    return
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  })

  const BASE_URL = PORTAL_URL

  await transporter.sendMail({
    from: `First Equity Funding <${gmailUser}>`,
    to: toEmail,
    subject: `Document uploaded — ${propertyAddress}`,
    html: `
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
        Hi ${toName},<br/><br/>
        <strong>${uploaderName}</strong> (Loan Processor) has uploaded a document to the First Equity Funding portal.
      </p>
      <table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Property</td><td><strong>${propertyAddress}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;">Condition</td><td><strong>${conditionTitle}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;">File</td><td><strong>${fileName}</strong></td></tr>
      </table>
      <p style="font-family:Arial,sans-serif;font-size:13px;color:#888;margin-top:24px;">
        Log in to the <a href="${BASE_URL}/loan-officer" style="color:#1F5D8F;">loan officer portal</a> to review.
      </p>
    `,
    attachments: fileBuffer ? [{ filename: fileName, content: fileBuffer }] : [],
  })
}
