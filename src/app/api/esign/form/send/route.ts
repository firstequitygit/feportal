// Send one of the fixed e-sign forms (public/esign-forms/) to a loan's
// borrower for signature via BoldSign. Staff-only (admin / LO / LP /
// UW). Mirrors the Term Sheet send flow: overlay the signature tags,
// send, record an esign_envelopes row. The webhook handles status +
// filing the signed PDF back on the loan.

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { isEsignEnabled, sendForSignature } from '@/lib/esign/boldsign'
import { getEsignForm } from '@/lib/esign/forms'
import { overlayEsignTags } from '@/lib/esign/overlay-tags'
import { formatLoanName } from '@/lib/format-loan-name'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block

  if (!isEsignEnabled()) {
    return NextResponse.json({ error: 'E-signature is not configured.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id, full_name').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('loan_processors').select('id, full_name').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).maybeSingle(),
  ])
  if (!admin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const staffName =
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    (admin?.full_name as string | undefined) ??
    'Staff'

  const { formKey, loanId, signerName, signerEmail } = (await req.json().catch(() => ({}))) as {
    formKey?: string; loanId?: string; signerName?: string; signerEmail?: string
  }

  const form = formKey ? getEsignForm(formKey) : undefined
  if (!form) return NextResponse.json({ error: 'Unknown form' }, { status: 400 })
  if (!loanId) return NextResponse.json({ error: 'Pick a loan' }, { status: 400 })
  if (!signerName?.trim() || !signerEmail?.trim()) {
    return NextResponse.json({ error: 'Signer name and email are required' }, { status: 400 })
  }

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address, loan_number, borrowers!borrower_id(full_name)')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  const loanName = formatLoanName({
    borrowerName: (loan.borrowers as unknown as { full_name: string | null } | null)?.full_name ?? null,
    propertyAddress: loan.property_address,
    loanNumber: loan.loan_number,
  })

  // Load the form PDF and overlay the signature tags.
  let pdf: Buffer
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'public', 'esign-forms', form.file))
    pdf = await overlayEsignTags(raw, form)
  } catch (err) {
    console.error('[esign] form load/overlay failed:', err)
    return NextResponse.json({ error: 'Could not prepare the form.' }, { status: 500 })
  }

  let documentId: string
  try {
    const result = await sendForSignature({
      title: `${form.label} — ${loanName}`,
      message: `Please review and sign the attached ${form.label} from First Equity Funding.`,
      pdf,
      signerName: signerName.trim(),
      signerEmail: signerEmail.trim(),
    })
    documentId = result.documentId
  } catch (err) {
    console.error('[esign] BoldSign send failed:', err)
    return NextResponse.json({ error: 'E-sign provider rejected the request. Check server logs.' }, { status: 502 })
  }

  const { data: envelope, error: insertErr } = await adminClient
    .from('esign_envelopes')
    .insert({
      loan_id: loanId,
      document_kind: form.key,
      provider: 'boldsign',
      provider_document_id: documentId,
      status: 'sent',
      signer_name: signerName.trim(),
      signer_email: signerEmail.trim(),
      sent_by: staffName,
    })
    .select('id')
    .single()
  if (insertErr) {
    console.error('[esign] envelope insert failed for BoldSign doc', documentId, insertErr)
    return NextResponse.json({ error: 'Sent, but failed to record envelope: ' + insertErr.message }, { status: 500 })
  }

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'esign_sent',
      description: `${form.label} sent for e-signature to ${signerName.trim()} <${signerEmail.trim()}> by ${staffName}`,
    })
  } catch (err) { console.error('esign_sent event log error:', err) }

  return NextResponse.json({ success: true, envelopeId: envelope.id })
}
