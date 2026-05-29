import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PORTAL_URL } from '@/lib/portal-url'
import { getStaffRecipientsForLoan } from '@/lib/staff-recipients'
import { sendEmail } from '@/lib/mailer'
import { assertNotImpersonating } from '@/lib/impersonate'

// Step 3 (LO): record uploaded documents and notify the staff team.
//
// Accepts either:
//   { loanId, conditionId, files: [{ fileName, fileSize, path }, ...] }
//   { loanId, conditionId, fileName, fileSize, path }   ← legacy single-file
//
// Batches result in ONE notification email per recipient with all
// attachments combined.
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

  const body = await req.json()
  const { loanId, conditionId } = body
  const files: Array<{ fileName: string; fileSize?: number | null; path: string }> =
    Array.isArray(body.files) && body.files.length > 0
      ? body.files
      : body.fileName && body.path
        ? [{ fileName: body.fileName, fileSize: body.fileSize ?? null, path: body.path }]
        : []

  if (!loanId || !conditionId || files.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Fetch loan (verify ownership). Notify-recipients are loaded via the
  // shared helper below.
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address')
    .eq('id', loanId)
    .eq('loan_officer_id', lo.id)
    .single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: condition } = await adminClient
    .from('conditions').select('title, status').eq('id', conditionId).single()

  const { error } = await adminClient.from('documents').insert(
    files.map(f => ({
      loan_id: loanId,
      condition_id: conditionId,
      file_name: f.fileName,
      file_path: f.path,
      file_size: f.fileSize ?? null,
    })),
  )

  if (error) {
    return NextResponse.json({ error: 'Could not save documents: ' + error.message }, { status: 500 })
  }

  // Flip the condition into the underwriter review queue when it was outstanding
  if (condition?.status === 'Outstanding' || condition?.status === 'Rejected') {
    await adminClient.from('conditions').update({ status: 'Received' }).eq('id', conditionId)
  }

  // One audit row per batch.
  try {
    const fileList = files.map(f => f.fileName).join(', ')
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'document_uploaded',
      description: `Loan officer ${lo.full_name} uploaded ${files.length === 1 ? 'a document' : `${files.length} documents`} for "${condition?.title ?? 'condition'}": ${fileList}`,
    })
  } catch (err) {
    console.error('Event log error:', err)
  }

  // Generate action token so the recipient can update the condition from
  // the email body.
  let actionToken: string | null = null
  try {
    const { data: tokenRow } = await adminClient
      .from('condition_action_tokens')
      .insert({ condition_id: conditionId, loan_id: loanId })
      .select('token')
      .single()
    actionToken = tokenRow?.token ?? null
  } catch (err) {
    console.error('Token generation error:', err)
  }

  // Download every uploaded file from Storage to attach.
  const attachments: Array<{ filename: string; content: Buffer }> = []
  for (const f of files) {
    try {
      const { data: fileData } = await adminClient.storage.from('documents').download(f.path)
      if (fileData) {
        attachments.push({ filename: f.fileName, content: Buffer.from(await fileData.arrayBuffer()) })
      }
    } catch (err) {
      console.error(`File download error (${f.fileName}):`, err)
    }
  }

  // Notify LO + primary LP. If neither role is assigned, skip the email
  // and log a warning (no general-inbox fallback — that mailbox isn't
  // monitored). One email per recipient per batch.
  try {
    const recipients = await getStaffRecipientsForLoan(loanId)
    if (recipients.recipients.length === 0) {
      console.warn(`LO upload: no staff recipients for loan ${loanId} — email skipped.`)
    } else {
      await Promise.all(recipients.recipients.map(r => sendNotification({
        toEmail: r.email,
        toName: r.name ?? (r.role === 'loan_officer' ? 'Loan Officer' : 'Loan Processor'),
        uploaderName: lo.full_name,
        uploaderRole: 'Loan Officer',
        propertyAddress: loan.property_address ?? 'Unknown property',
        conditionTitle: condition?.title ?? 'Unknown condition',
        fileNames: files.map(f => f.fileName),
        attachments,
        actionToken,
      })))
    }
  } catch (err) {
    console.error('Email notification error:', err)
  }

  return NextResponse.json({ success: true, recorded: files.length })
}

const BASE_URL = PORTAL_URL

function actionButton(label: string, action: string, token: string, bgColor: string) {
  const url = `${BASE_URL}/api/conditions/action?token=${token}&action=${action}`
  return `<a href="${url}" style="display:inline-block;padding:10px 20px;background:${bgColor};color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;font-weight:600;margin-right:8px;">${label}</a>`
}

async function sendNotification({
  toEmail,
  toName,
  uploaderName,
  uploaderRole,
  propertyAddress,
  conditionTitle,
  fileNames,
  attachments,
  actionToken,
}: {
  toEmail: string
  toName: string
  uploaderName: string
  uploaderRole: string
  propertyAddress: string
  conditionTitle: string
  fileNames: string[]
  attachments: Array<{ filename: string; content: Buffer }>
  actionToken: string | null
}) {
  const actionButtons = actionToken
    ? `<div style="margin-top:24px;">
        <p style="font-family:Arial,sans-serif;font-size:13px;color:#555;margin:0 0 12px;">Update this condition directly from your email:</p>
        <div>
          ${actionButton('📥 Mark Received',  'received',  actionToken, '#2563eb')}
          ${actionButton('✅ Mark Satisfied', 'satisfied', actionToken, '#16a34a')}
          ${actionButton('❌ Mark Rejected',  'rejected',  actionToken, '#dc2626')}
        </div>
        <p style="font-family:Arial,sans-serif;font-size:11px;color:#aaa;margin-top:12px;">These links expire in 7 days.</p>
      </div>`
    : ''

  const fileLabel = fileNames.length === 1 ? 'File' : `Files (${fileNames.length})`
  const fileBlock = fileNames.length === 1
    ? `<strong>${fileNames[0]}</strong>`
    : `<ul style="margin:0;padding-left:18px;">${fileNames.map(n => `<li><strong>${n}</strong></li>`).join('')}</ul>`
  const subjectFiles = fileNames.length === 1 ? '' : ` (${fileNames.length} files)`

  await sendEmail({
    to: toEmail,
    subject: `Document${fileNames.length === 1 ? '' : 's'} uploaded — ${propertyAddress}${subjectFiles}`,
    html: `
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
        Hi ${toName},<br/><br/>
        <strong>${uploaderName}</strong> (${uploaderRole}) has uploaded ${fileNames.length === 1 ? 'a document' : `${fileNames.length} documents`} to the First Equity Funding portal.
      </p>
      <table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">
        <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">Property</td><td><strong>${propertyAddress}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">Condition</td><td><strong>${conditionTitle}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">${fileLabel}</td><td>${fileBlock}</td></tr>
      </table>
      ${actionButtons}
      <p style="font-family:Arial,sans-serif;font-size:13px;color:#888;margin-top:24px;">
        Or log in to the <a href="${BASE_URL}/loan-processor" style="color:#1F5D8F;">processor portal</a> to review.
      </p>
    `,
    attachments,
  })
}
