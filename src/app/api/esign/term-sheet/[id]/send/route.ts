// Send the Term Sheet (with the W-9 appended as its last page) out
// for e-signature via BoldSign.
//
// Staff-only. Renders the same React-PDF Term Sheet the Download
// button produces, appends the W-9 stamped with the loan's entity
// name, and creates a BoldSign envelope. The signer defaults to the
// primary borrower; the E-Signature console may pass an override
// (e.g. a broker) in the body: { signerName?, signerEmail? }.
//
// One active envelope per loan: if a term-sheet envelope is already
// out (sent/viewed/signed), this returns 409 so staff don't spam
// the borrower with duplicates. Revoke/decline/complete first.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isEsignEnabled, sendForSignature } from '@/lib/esign/boldsign'
import { buildTermSheetPackage } from '@/lib/esign/term-sheet-package'

export const runtime = 'nodejs'

type StaffIdentity = { role: string; name: string | null }

async function getStaffIdentity(authUserId: string): Promise<StaffIdentity | null> {
  const adminClient = createAdminClient()
  const [
    { data: adminUser },
    { data: lo },
    { data: lp },
    { data: uw },
  ] = await Promise.all([
    adminClient.from('admin_users').select('id, full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_processors').select('id, full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', authUserId).maybeSingle(),
  ])
  if (adminUser) return { role: 'Administrator', name: adminUser.full_name }
  if (lo) return { role: 'Loan Officer', name: lo.full_name }
  if (lp) return { role: 'Loan Processor', name: lp.full_name }
  if (uw) return { role: 'Underwriter', name: uw.full_name }
  return null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!isEsignEnabled()) {
    return NextResponse.json({ error: 'E-sign is not configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const staff = await getStaffIdentity(user.id)
  if (!staff) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const adminClient = createAdminClient()

  // Block duplicate active envelopes for this loan's term sheet.
  const { data: active } = await adminClient
    .from('esign_envelopes')
    .select('id, status')
    .eq('loan_id', id)
    .eq('document_kind', 'term_sheet')
    .in('status', ['sent', 'viewed', 'signed'])
    .limit(1)
    .maybeSingle()
  if (active) {
    return NextResponse.json(
      { error: 'A Term Sheet is already out for signature on this loan.' },
      { status: 409 },
    )
  }

  const pkg = await buildTermSheetPackage(adminClient, id)
  if ('error' in pkg) {
    return NextResponse.json({ error: pkg.error }, { status: pkg.status })
  }

  // Signer: the primary borrower unless the caller overrides (the
  // E-Signature console lets staff send to a broker instead).
  const body = (await req.json().catch(() => ({}))) as { signerName?: string; signerEmail?: string }
  const signerName = body.signerName?.trim() || pkg.borrower.full_name
  const signerEmail = body.signerEmail?.trim() || pkg.borrower.email
  if (!signerName || !signerEmail) {
    return NextResponse.json(
      { error: 'Primary borrower needs a name and email on file before sending for signature.' },
      { status: 400 },
    )
  }

  let documentId: string
  try {
    const result = await sendForSignature({
      title: `Loan Term Sheet — ${pkg.loanName}`,
      message:
        'Please review and sign the attached Loan Term Sheet and W-9 from First Equity Funding. ' +
        'You can also sign directly in your borrower portal.',
      pdf: pkg.pdf,
      signerName,
      signerEmail,
      formFields: pkg.fields,
    })
    documentId = result.documentId
  } catch (err) {
    console.error('[esign] BoldSign send failed:', err)
    return NextResponse.json(
      { error: 'E-sign provider rejected the request. Check server logs.' },
      { status: 502 },
    )
  }

  const { data: envelope, error: insertErr } = await adminClient
    .from('esign_envelopes')
    .insert({
      loan_id: id,
      document_kind: 'term_sheet',
      provider: 'boldsign',
      provider_document_id: documentId,
      status: 'sent',
      signer_name: signerName,
      signer_email: signerEmail,
      sent_by: staff.name ?? staff.role,
    })
    .select('id')
    .single()

  if (insertErr) {
    // Envelope exists at BoldSign but we couldn't record it — log
    // loudly; the webhook will still fire but find no row.
    console.error('[esign] envelope insert failed for BoldSign doc', documentId, insertErr)
    return NextResponse.json({ error: 'Sent, but failed to record envelope: ' + insertErr.message }, { status: 500 })
  }

  await adminClient.from('loan_events').insert({
    loan_id: id,
    event_type: 'esign_sent',
    description: `Term Sheet (with W-9) sent for e-signature to ${signerName} (${signerEmail}) by ${staff.name ?? staff.role}`,
  })

  return NextResponse.json({ ok: true, success: true, envelopeId: envelope.id, documentId })
}
