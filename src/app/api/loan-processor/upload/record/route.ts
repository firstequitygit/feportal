import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PORTAL_URL } from '@/lib/portal-url'
import { getStaffRecipientsForLoan } from '@/lib/staff-recipients'
import { sendEmail } from '@/lib/mailer'
import { assertNotImpersonating } from '@/lib/impersonate'
import { setConditionReceived } from '@/lib/condition-set-received'

// LP upload record. Same multi-file batch shape as the LO route — accepts
// either `files: [...]` or the legacy single-file fields.
export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lp } = await adminClient
    .from('loan_processors').select('id, full_name, is_ops_manager').eq('auth_user_id', user.id).single()
  if (!lp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  // Fetch loan (verify ownership). Ops managers can upload to any loan.
  const loanQ = adminClient
    .from('loans')
    .select('id, property_address')
    .eq('id', loanId)
  const { data: loan } = await (lp.is_ops_manager
    ? loanQ.single()
    : loanQ.or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`).single())
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

  if (error) return NextResponse.json({ error: 'Could not save documents: ' + error.message }, { status: 500 })

  // Flip into Received + fire urgent-received email when applicable.
  if (condition?.status === 'Outstanding' || condition?.status === 'Rejected') {
    await setConditionReceived({ adminClient, conditionId })
  }

  try {
    const fileList = files.map(f => f.fileName).join(', ')
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'document_uploaded',
      description: `Loan processor ${lp.full_name} uploaded ${files.length === 1 ? 'a document' : `${files.length} documents`} for "${condition?.title ?? 'condition'}": ${fileList}`,
    })
  } catch (err) {
    console.error('Event log error:', err)
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

  // Notify LO + primary LP. Per FE policy: any condition-received event
  // notifies both staff roles, regardless of who triggered it. One email
  // per recipient per batch.
  try {
    const recipients = await getStaffRecipientsForLoan(loanId)
    if (recipients.recipients.length === 0) {
      console.warn(`LP upload: no staff recipients for loan ${loanId} — email skipped.`)
    } else {
      await Promise.all(recipients.recipients.map(r => sendNotification({
        toEmail: r.email,
        toName: r.name ?? (r.role === 'loan_officer' ? 'Loan Officer' : 'Loan Processor'),
        uploaderName: lp.full_name,
        propertyAddress: loan.property_address ?? 'Unknown property',
        conditionTitle: condition?.title ?? 'Unknown condition',
        fileNames: files.map(f => f.fileName),
        attachments,
      })))
    }
  } catch (err) {
    console.error('Email notification error:', err)
  }

  return NextResponse.json({ success: true, recorded: files.length })
}

async function sendNotification({
  toEmail,
  toName,
  uploaderName,
  propertyAddress,
  conditionTitle,
  fileNames,
  attachments,
}: {
  toEmail: string
  toName: string
  uploaderName: string
  propertyAddress: string
  conditionTitle: string
  fileNames: string[]
  attachments: Array<{ filename: string; content: Buffer }>
}) {
  const BASE_URL = PORTAL_URL
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
        <strong>${uploaderName}</strong> (Loan Processor) has uploaded ${fileNames.length === 1 ? 'a document' : `${fileNames.length} documents`} to the First Equity Funding portal.
      </p>
      <table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">
        <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">Property</td><td><strong>${propertyAddress}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">Condition</td><td><strong>${conditionTitle}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">${fileLabel}</td><td>${fileBlock}</td></tr>
      </table>
      <p style="font-family:Arial,sans-serif;font-size:13px;color:#888;margin-top:24px;">
        Log in to the <a href="${BASE_URL}/loan-officer" style="color:#1F5D8F;">loan officer portal</a> to review.
      </p>
    `,
    attachments,
  })
}
