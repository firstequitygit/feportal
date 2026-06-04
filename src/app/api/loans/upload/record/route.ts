import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { verifyContactAccess } from '@/lib/contact-access'
import { setConditionReceived } from '@/lib/condition-set-received'
import { getStaffRecipientsForLoan } from '@/lib/staff-recipients'
import { PORTAL_URL } from '@/lib/portal-url'
import { sendEmail } from '@/lib/mailer'

// Step 3: Record uploaded documents in the database and notify staff.
//
// Accepts either:
//   { loanId, conditionId, files: [{ fileName, fileSize, path }, ...] }
//   { loanId, conditionId, fileName, fileSize, path }   ← legacy single-file
//
// Multi-file batches are inserted together and result in ONE notification
// email with all attachments combined — instead of N emails when N files
// were uploaded to the same condition simultaneously.
export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // Accept either the borrower OR the broker on this loan
  const access = await verifyContactAccess(user.id, loanId)
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  // Pull the uploader's display name + email for the staff notification
  let uploaderName = 'A contact'
  if (access.role === 'broker' && access.brokerId) {
    const { data: b } = await adminClient.from('brokers')
      .select('full_name, email, company_name').eq('id', access.brokerId).single()
    if (b) uploaderName = `${b.full_name ?? b.email}${b.company_name ? ` (${b.company_name})` : ''} [Broker]`
  } else if (access.borrowerId) {
    const { data: b } = await adminClient.from('borrowers')
      .select('full_name, email').eq('id', access.borrowerId).single()
    if (b) uploaderName = b.full_name ?? b.email ?? 'A borrower'
  }

  // Get loan and condition details for the notification
  const [{ data: loan }, { data: condition }] = await Promise.all([
    adminClient.from('loans').select('property_address').eq('id', loanId).single(),
    adminClient.from('conditions').select('title, status').eq('id', conditionId).single(),
  ])

  // Insert all documents in one batch.
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
    console.error('Document record error:', error)
    return NextResponse.json({ error: 'Could not save documents: ' + error.message }, { status: 500 })
  }

  // Flip the condition into the underwriter review queue when it was outstanding.
  // Document uploads intentionally do NOT nudge the UW per file — the
  // status change is enough; UW reviews their own queue. Manual status
  // changes from staff still email the UW via their dedicated routes.
  if (condition?.status === 'Outstanding' || condition?.status === 'Rejected') {
    await setConditionReceived({ adminClient, conditionId, notifyUwOnUrgentReceived: false })
  }

  // One event row per batch (lists every file name) so the activity feed
  // shows one entry per "upload session" instead of N entries.
  try {
    const fileList = files.map(f => f.fileName).join(', ')
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'document_uploaded',
      description: `${files.length === 1 ? 'Document' : `${files.length} documents`} uploaded for "${condition?.title ?? 'condition'}": ${fileList}`,
    })
  } catch (err) {
    console.error('Event log error (document_uploaded):', err)
  }

  // Generate an action token for one-click condition updates from email
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

  // Download every uploaded file from Storage to attach to the email.
  // Failures attach nothing for that file but don't break the rest.
  const attachments: Array<{ filename: string; content: Buffer }> = []
  for (const f of files) {
    try {
      const { data: fileData } = await adminClient.storage.from('documents').download(f.path)
      if (fileData) {
        attachments.push({ filename: f.fileName, content: Buffer.from(await fileData.arrayBuffer()) })
      }
    } catch (err) {
      console.error(`File download for attachment error (${f.fileName}):`, err)
    }
  }

  // Notify the primary LP + LO assigned to this loan — one email per batch.
  try {
    const recipients = await getStaffRecipientsForLoan(loanId)
    if (recipients.emails.length > 0) {
      await sendNotification({
        toEmails: recipients.emails,
        borrowerName: uploaderName,
        propertyAddress: loan?.property_address ?? recipients.property_address ?? 'Unknown property',
        conditionTitle: condition?.title ?? 'Unknown condition',
        fileNames: files.map(f => f.fileName),
        attachments,
        actionToken,
      })
      console.log(`Upload notification sent to ${recipients.emails.join(', ')} for ${files.length} file(s)`)
    } else {
      console.warn(`No staff recipients for loan ${loanId} — upload notification skipped.`)
    }
  } catch (err) {
    console.error('Email notification error:', err)
  }

  return NextResponse.json({ success: true, recorded: files.length })
}

const BASE_URL = PORTAL_URL

function actionButton(label: string, action: string, token: string, bgColor: string) {
  const url = `${BASE_URL}/api/conditions/action?token=${token}&action=${action}`
  return `
    <a href="${url}"
       style="display:inline-block; padding:10px 20px; background:${bgColor}; color:#fff;
              text-decoration:none; border-radius:6px; font-family:Arial,sans-serif;
              font-size:13px; font-weight:600; margin-right:8px;">
      ${label}
    </a>`
}

async function sendNotification({
  toEmails,
  borrowerName,
  propertyAddress,
  conditionTitle,
  fileNames,
  attachments,
  actionToken,
}: {
  toEmails: string[]
  borrowerName: string
  propertyAddress: string
  conditionTitle: string
  fileNames: string[]
  attachments: Array<{ filename: string; content: Buffer }>
  actionToken: string | null
}) {
  const actionButtons = actionToken
    ? `
      <div style="margin-top: 24px;">
        <p style="font-family: Arial, sans-serif; font-size: 13px; color: #555; margin: 0 0 12px;">
          Update this condition directly from your email:
        </p>
        <div>
          ${actionButton('📥 Mark Received',  'received',  actionToken, '#2563eb')}
          ${actionButton('✅ Mark Satisfied', 'satisfied', actionToken, '#16a34a')}
          ${actionButton('❌ Mark Rejected',  'rejected',  actionToken, '#dc2626')}
        </div>
        <p style="font-family: Arial, sans-serif; font-size: 11px; color: #aaa; margin-top: 12px;">
          These links expire in 7 days.
        </p>
      </div>`
    : ''

  const fileLabel = fileNames.length === 1 ? 'File' : `Files (${fileNames.length})`
  const fileBlock = fileNames.length === 1
    ? `<strong>${fileNames[0]}</strong>`
    : `<ul style="margin: 0; padding-left: 18px;">${fileNames.map(n => `<li><strong>${n}</strong></li>`).join('')}</ul>`
  const subjectFiles = fileNames.length === 1 ? '' : ` (${fileNames.length} files)`

  await sendEmail({
    to: toEmails.join(', '),
    subject: `Document${fileNames.length === 1 ? '' : 's'} uploaded — ${propertyAddress}${subjectFiles}`,
    html: `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        <strong>${borrowerName}</strong> has uploaded ${fileNames.length === 1 ? 'a document' : `${fileNames.length} documents`} on the First Equity Funding Online Portal.
      </p>
      <table style="font-family: Arial, sans-serif; font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
        <tr><td style="padding: 4px 16px 4px 0; color: #666; vertical-align: top;">Property</td><td><strong>${propertyAddress}</strong></td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #666; vertical-align: top;">Condition</td><td><strong>${conditionTitle}</strong></td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #666; vertical-align: top;">${fileLabel}</td><td>${fileBlock}</td></tr>
      </table>
      ${actionButtons}
      <p style="font-family: Arial, sans-serif; font-size: 13px; color: #888; margin-top: 24px;">
        Or <a href="${BASE_URL}/dashboard" style="color: #1F5D8F;">log in to the portal</a> to review.
      </p>
    `,
    attachments,
  })
}
