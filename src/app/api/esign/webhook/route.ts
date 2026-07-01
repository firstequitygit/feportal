// BoldSign webhook receiver. Configure in the BoldSign dashboard:
//   Settings → Webhooks → Add endpoint
//   URL:   https://firstequity.irongateportals.com/api/esign/webhook
//   Secret: copy into the BOLDSIGN_WEBHOOK_SECRET env var
//   Events: at minimum Viewed, Signed, Completed, Declined, Revoked, Expired
//
// Each event updates the matching esign_envelopes row. On Completed
// we also download the signed PDF from BoldSign, store it in the
// documents bucket, and insert a documents row so the signed Term
// Sheet shows up on the loan like any other uploaded file.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature, downloadDocument } from '@/lib/esign/boldsign'
import { ESIGN_DOC_LABELS } from '@/lib/esign/forms'

export const runtime = 'nodejs'

// BoldSign event type → our envelope status. Unmapped events
// (Sent, Reminded, …) are acknowledged but ignored.
const STATUS_BY_EVENT: Record<string, string> = {
  Viewed: 'viewed',
  Signed: 'signed',
  Completed: 'completed',
  Declined: 'declined',
  Revoked: 'revoked',
  Expired: 'expired',
}

export async function POST(req: Request) {
  // Raw body is required for HMAC verification — keep it as text and
  // parse JSON separately.
  const rawBody = await req.text()
  const signature = req.headers.get('x-boldsign-signature')

  let payload: {
    event?: { eventType?: string }
    document?: { documentId?: string; status?: string }
    data?: { documentId?: string; status?: string }
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = payload.event?.eventType ?? ''

  // BoldSign's "Verify" button (API → Webhooks → Add Webhook) sends a
  // Verification ping and requires a 200 within 10 seconds. The
  // signing secret isn't known until AFTER the webhook is saved, so
  // this one event type is acknowledged without signature
  // verification. It carries no document data and triggers no writes.
  if (eventType === 'Verification') {
    return NextResponse.json({ ok: true, verified: true })
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  // BoldSign nests the document under `document` for document events;
  // tolerate `data` as well in case the shape shifts.
  const documentId = payload.document?.documentId ?? payload.data?.documentId

  const newStatus = STATUS_BY_EVENT[eventType]
  if (!newStatus || !documentId) {
    // Not an event we track — 200 so BoldSign doesn't retry.
    return NextResponse.json({ ok: true, ignored: eventType || 'unknown' })
  }

  const adminClient = createAdminClient()

  const { data: envelope } = await adminClient
    .from('esign_envelopes')
    .select('id, loan_id, document_kind, status, signer_name, signed_document_id')
    .eq('provider_document_id', documentId)
    .maybeSingle()

  if (!envelope) {
    // Unknown envelope (e.g., created directly in the BoldSign UI).
    // Acknowledge — nothing to update.
    return NextResponse.json({ ok: true, ignored: 'no matching envelope' })
  }

  // Terminal states shouldn't regress (e.g., a late Viewed event
  // arriving after Completed).
  const TERMINAL = ['completed', 'declined', 'revoked', 'expired']
  if (TERMINAL.includes(envelope.status) && !TERMINAL.includes(newStatus)) {
    return NextResponse.json({ ok: true, ignored: 'envelope already terminal' })
  }

  const update: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }
  if (newStatus === 'completed') update.completed_at = new Date().toISOString()

  // On completion, pull the executed PDF and file it on the loan.
  // Idempotent: skip if a prior delivery already stored it.
  if (newStatus === 'completed' && !envelope.signed_document_id) {
    try {
      const signedPdf = await downloadDocument(documentId)
      const filePath = `${envelope.loan_id}/esign-${documentId}.pdf`

      const { error: uploadErr } = await adminClient.storage
        .from('documents')
        .upload(filePath, signedPdf, { contentType: 'application/pdf', upsert: true })
      if (uploadErr) throw new Error('storage upload: ' + uploadErr.message)

      const label = ESIGN_DOC_LABELS[envelope.document_kind as string]
      const docName = label
        ? `Signed ${label} — ${envelope.signer_name ?? 'borrower'}.pdf`
        : `Signed document — ${envelope.signer_name ?? 'borrower'}.pdf`

      const { data: docRow, error: docErr } = await adminClient
        .from('documents')
        .insert({
          loan_id: envelope.loan_id,
          condition_id: null,
          file_name: docName,
          file_path: filePath,
          file_size: signedPdf.length,
        })
        .select('id')
        .single()
      if (docErr) throw new Error('documents insert: ' + docErr.message)

      update.signed_document_id = docRow.id
    } catch (err) {
      // Status still updates; the signed file can be re-pulled later
      // from the BoldSign dashboard if this download failed.
      console.error('[esign webhook] failed to store signed PDF for', documentId, err)
    }
  }

  await adminClient
    .from('esign_envelopes')
    .update(update)
    .eq('id', envelope.id)

  // Audit log entry for the loan timeline.
  const eventDescriptions: Record<string, string> = {
    viewed: `Term Sheet signature request viewed by ${envelope.signer_name ?? 'signer'}`,
    signed: `Term Sheet signed by ${envelope.signer_name ?? 'signer'}`,
    completed: `Term Sheet e-signature completed — signed copy filed on the loan`,
    declined: `Term Sheet signature request declined by ${envelope.signer_name ?? 'signer'}`,
    revoked: `Term Sheet signature request revoked`,
    expired: `Term Sheet signature request expired`,
  }
  try {
    await adminClient.from('loan_events').insert({
      loan_id: envelope.loan_id,
      event_type: `esign_${newStatus}`,
      description: eventDescriptions[newStatus] ?? `E-sign status: ${newStatus}`,
    })
  } catch (err) {
    console.error('[esign webhook] loan_events insert failed:', err)
  }

  return NextResponse.json({ ok: true })
}
