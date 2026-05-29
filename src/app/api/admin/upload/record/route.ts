import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PORTAL_URL } from '@/lib/portal-url'
import { getStaffRecipientsForLoan } from '@/lib/staff-recipients'
import { sendEmail } from '@/lib/mailer'
import { assertNotImpersonating } from '@/lib/impersonate'

// Admin upload record. Accepts either:
//   { loanId, conditionId, files: [{ fileName, fileSize, path }, ...] }
//   { loanId, conditionId, fileName, fileSize, path }   ← legacy single-file
// Batches notify staff once per upload session.
export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  const adminClient = createAdminClient()

  const [{ data: loan }, { data: condition }] = await Promise.all([
    adminClient.from('loans').select('property_address').eq('id', loanId).single(),
    adminClient.from('conditions').select('title, status').eq('id', conditionId).single(),
  ])

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

  try {
    const fileList = files.map(f => f.fileName).join(', ')
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'document_uploaded',
      description: `Admin uploaded ${files.length === 1 ? 'a document' : `${files.length} documents`} for "${condition?.title ?? 'condition'}": ${fileList}`,
    })
  } catch (err) {
    console.error('Event log error:', err)
  }

  // Attach every uploaded file.
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

  // Notify LO + primary LP — one email per recipient per batch.
  try {
    const recipients = await getStaffRecipientsForLoan(loanId)
    if (recipients.recipients.length === 0) {
      console.warn(`Admin upload: no staff recipients for loan ${loanId} — email skipped.`)
    } else {
      const addr = loan?.property_address ?? recipients.property_address ?? 'Unknown property'
      const condTitle = condition?.title ?? 'Unknown condition'
      const fileNames = files.map(f => f.fileName)
      const fileLabel = fileNames.length === 1 ? 'File' : `Files (${fileNames.length})`
      const fileBlock = fileNames.length === 1
        ? `<strong>${fileNames[0]}</strong>`
        : `<ul style="margin:0;padding-left:18px;">${fileNames.map(n => `<li><strong>${n}</strong></li>`).join('')}</ul>`
      const subjectFiles = fileNames.length === 1 ? '' : ` (${fileNames.length} files)`

      await Promise.all(recipients.recipients.map(r => sendEmail({
        to: r.email,
        subject: `Document${fileNames.length === 1 ? '' : 's'} uploaded — ${addr}${subjectFiles}`,
        html: `
          <p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
            Hi ${r.name ?? 'there'},<br/><br/>
            An admin has uploaded ${fileNames.length === 1 ? 'a document' : `${fileNames.length} documents`} to the First Equity Funding portal.
          </p>
          <table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">
            <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">Property</td><td><strong>${addr}</strong></td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">Condition</td><td><strong>${condTitle}</strong></td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">${fileLabel}</td><td>${fileBlock}</td></tr>
          </table>
          <p style="font-family:Arial,sans-serif;font-size:13px;color:#888;margin-top:24px;">
            <a href="${PORTAL_URL}/${r.role === 'loan_officer' ? 'loan-officer' : 'loan-processor'}" style="color:#1F5D8F;">Log in to the portal</a> to review.
          </p>
        `,
        attachments,
      })))
    }
  } catch (err) {
    console.error('Email notification error:', err)
  }

  return NextResponse.json({ success: true, recorded: files.length })
}
