// Embedded e-signing page for borrowers. Verifies the signed-in
// borrower is the envelope's signer, mints a short-lived BoldSign
// embedded sign link server-side, and renders it in an iframe so
// the borrower signs without leaving the portal.
//
// After signing, BoldSign redirects (inside the iframe) to the loan
// page with ?signed=1; the webhook updates the envelope + files the
// executed PDF.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { isEsignEnabled, getEmbeddedSignLink, siteUrl } from '@/lib/esign/boldsign'

export default async function SignPage({
  params,
}: {
  params: Promise<{ id: string; envelopeId: string }>
}) {
  const { id, envelopeId } = await params

  if (!isEsignEnabled()) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  // Borrower identity + membership on this loan.
  const { data: borrower } = await supabase
    .from('borrowers')
    .select('id, full_name, email')
    .eq('auth_user_id', user.id)
    .single()
  if (!borrower) redirect('/login')

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address')
    .eq('id', id)
    .or(`borrower_id.eq.${borrower.id},borrower_id_2.eq.${borrower.id},borrower_id_3.eq.${borrower.id},borrower_id_4.eq.${borrower.id}`)
    .single()
  if (!loan) notFound()

  const { data: envelope } = await adminClient
    .from('esign_envelopes')
    .select('id, loan_id, status, provider_document_id, signer_email, signer_name')
    .eq('id', envelopeId)
    .eq('loan_id', id)
    .maybeSingle()
  if (!envelope) notFound()

  // Only the designated signer can open their signing session.
  const isSigner =
    !!borrower.email &&
    !!envelope.signer_email &&
    borrower.email.toLowerCase() === envelope.signer_email.toLowerCase()

  const stillSignable = envelope.status === 'sent' || envelope.status === 'viewed'

  let signLink: string | null = null
  let linkError: string | null = null
  if (isSigner && stillSignable) {
    try {
      signLink = await getEmbeddedSignLink(
        envelope.provider_document_id,
        envelope.signer_email!,
        `${siteUrl()}/loans/${id}?signed=1`,
      )
    } catch (err) {
      console.error('[esign] embedded sign link failed:', err)
      linkError = 'We could not load the signing session. Please try again, or use the link in your email.'
    }
  }

  return (
    <PortalShell
      userName={borrower.full_name ?? user.email ?? null}
      userRole="Borrower"
      dashboardHref="/dashboard"
    >
      <Link href={`/loans/${id}`} className="text-sm text-primary hover:opacity-80 mb-4 inline-block">
        ← Back to Loan
      </Link>

      <h2 className="text-2xl font-bold text-gray-900 mt-2 mb-4">Sign Term Sheet</h2>

      {!isSigner && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md p-4 text-sm">
          This signature request was sent to {envelope.signer_name ?? 'another borrower'} on this
          loan. Only the designated signer can open the signing session.
        </div>
      )}

      {isSigner && !stillSignable && (
        <div className="bg-gray-50 border border-gray-200 text-gray-700 rounded-md p-4 text-sm">
          {envelope.status === 'completed' || envelope.status === 'signed'
            ? 'This document has already been signed — a copy is saved on your loan.'
            : `This signature request is no longer active (status: ${envelope.status}).`}
        </div>
      )}

      {isSigner && stillSignable && linkError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-4 text-sm">
          {linkError}
        </div>
      )}

      {signLink && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          <iframe
            src={signLink}
            title="Sign Term Sheet"
            className="w-full"
            style={{ height: 'calc(100vh - 220px)', minHeight: 600 }}
          />
        </div>
      )}
    </PortalShell>
  )
}
