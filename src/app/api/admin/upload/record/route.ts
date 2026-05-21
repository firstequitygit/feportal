import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PORTAL_URL } from '@/lib/portal-url'
import { getStaffRecipientsForLoan } from '@/lib/staff-recipients'
import { sendEmail } from '@/lib/mailer'

// Records an admin-uploaded document in the database
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, conditionId, fileName, fileSize, path } = await req.json()
  if (!loanId || !conditionId || !fileName || !path) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const [{ data: loan }, { data: condition }] = await Promise.all([
    adminClient.from('loans').select('property_address').eq('id', loanId).single(),
    adminClient.from('conditions').select('title, status').eq('id', conditionId).single(),
  ])

  const { error } = await adminClient.from('documents').insert({
    loan_id: loanId,
    condition_id: conditionId,
    file_name: fileName,
    file_path: path,
    file_size: fileSize ?? null,
  })

  if (error) {
    return NextResponse.json({ error: 'Could not save document: ' + error.message }, { status: 500 })
  }

  // Flip the condition into the underwriter review queue when it was outstanding
  if (condition?.status === 'Outstanding' || condition?.status === 'Rejected') {
    await adminClient.from('conditions').update({ status: 'Received' }).eq('id', conditionId)
  }

  // Log event
  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'document_uploaded',
      description: `Admin uploaded document for "${condition?.title ?? 'condition'}": ${fileName}`,
    })
  } catch (err) {
    console.error('Event log error:', err)
  }

  // Attach the file
  let fileBuffer: Buffer | null = null
  try {
    const { data: fileData } = await adminClient.storage.from('documents').download(path)
    if (fileData) fileBuffer = Buffer.from(await fileData.arrayBuffer())
  } catch (err) {
    console.error('File download error:', err)
  }

  // Notify LO + primary LP
  try {
    const recipients = await getStaffRecipientsForLoan(loanId)
    if (recipients.recipients.length === 0) {
      console.warn(`Admin upload: no staff recipients for loan ${loanId} — email skipped.`)
    } else {
      {
        const addr = loan?.property_address ?? recipients.property_address ?? 'Unknown property'
        const condTitle = condition?.title ?? 'Unknown condition'
        await Promise.all(recipients.recipients.map(r => sendEmail({          to: r.email,
          subject: `Document uploaded — ${addr}`,
          html: `
            <p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
              Hi ${r.name ?? 'there'},<br/><br/>
              An admin has uploaded a document to the First Equity Funding portal.
            </p>
            <table style="font-family:Arial,sans-serif;font-size:14px;color:#333;border-collapse:collapse;margin-top:12px;">
              <tr><td style="padding:4px 16px 4px 0;color:#666;">Property</td><td><strong>${addr}</strong></td></tr>
              <tr><td style="padding:4px 16px 4px 0;color:#666;">Condition</td><td><strong>${condTitle}</strong></td></tr>
              <tr><td style="padding:4px 16px 4px 0;color:#666;">File</td><td><strong>${fileName}</strong></td></tr>
            </table>
            <p style="font-family:Arial,sans-serif;font-size:13px;color:#888;margin-top:24px;">
              <a href="${PORTAL_URL}/${r.role === 'loan_officer' ? 'loan-officer' : 'loan-processor'}" style="color:#1F5D8F;">Log in to the portal</a> to review.
            </p>
          `,
          attachments: fileBuffer ? [{ filename: fileName, content: fileBuffer }] : [],
        })))
      }
    }
  } catch (err) {
    console.error('Email notification error:', err)
  }

  return NextResponse.json({ success: true })
}
