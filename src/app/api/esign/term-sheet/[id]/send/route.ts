// Send the Term Sheet out for e-signature via BoldSign.
//
// Staff-only. Renders the same React-PDF Term Sheet the Download
// button produces — plus invisible text tags over the Acceptance
// signature/date lines — and creates a BoldSign envelope with the
// primary borrower as the signer. The borrower gets BoldSign's
// email immediately (email fallback) and can also sign embedded
// in the portal via /loans/[id]/sign/[envelopeId].
//
// One active envelope per loan: if a term-sheet envelope is already
// out (sent/viewed/signed), this returns 409 so staff don't spam
// the borrower with duplicates. Revoke/decline/complete first.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderTermSheetPdf } from '@/lib/pdf/term-sheet-pdf'
import { isEsignEnabled, sendForSignature } from '@/lib/esign/boldsign'
import { formatLoanName } from '@/lib/format-loan-name'

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

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // Same data fetch as the PDF download route.
  const { data: loan } = await adminClient
    .from('loans')
    .select(`
      *,
      borrowers!borrower_id(full_name, email, current_address_street, current_address_city, current_address_state, current_address_zip),
      borrower_2:borrowers!borrower_id_2(full_name),
      borrower_3:borrowers!borrower_id_3(full_name),
      borrower_4:borrowers!borrower_id_4(full_name)
    `)
    .eq('id', id)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  const borrower = loan.borrowers as unknown as {
    full_name: string | null
    email: string | null
    current_address_street: string | null
    current_address_city: string | null
    current_address_state: string | null
    current_address_zip: string | null
  } | null

  if (!borrower?.email || !borrower.full_name) {
    return NextResponse.json(
      { error: 'Primary borrower needs a name and email on file before sending for signature.' },
      { status: 400 },
    )
  }

  const co1 = (loan as unknown as { borrower_2: { full_name: string | null } | null }).borrower_2
  const co2 = (loan as unknown as { borrower_3: { full_name: string | null } | null }).borrower_3
  const co3 = (loan as unknown as { borrower_4: { full_name: string | null } | null }).borrower_4
  const coBorrowerNames = [co1?.full_name, co2?.full_name, co3?.full_name]
    .filter((x): x is string => !!x)

  const { data: details } = await adminClient
    .from('loan_details')
    .select(`
      rate_type, amortization_schedule, prepayment_penalty,
      points, broker_points,
      underwriting_fee, legal_doc_prep_fee, desk_review_fee, small_balance_fee,
      feasibility_fee, construction_holdback, draw_fee,
      initial_loan_amount, purchase_price,
      property_street, property_city, property_state, property_zip,
      additional_fees, additional_fees_notes
    `)
    .eq('loan_id', id)
    .maybeSingle()

  const pdf = await renderTermSheetPdf({
    loan: {
      loan_type: loan.loan_type,
      loan_amount: loan.loan_amount,
      interest_rate: loan.interest_rate,
      term_months: loan.term_months,
      interest_only: loan.interest_only,
      arv: loan.arv,
      rehab_budget: loan.rehab_budget,
      entity_name: loan.entity_name,
      property_address: loan.property_address,
    },
    details: {
      rate_type: details?.rate_type ?? null,
      amortization_schedule: details?.amortization_schedule ?? null,
      prepayment_penalty: details?.prepayment_penalty ?? null,
      points: details?.points ?? null,
      broker_points: details?.broker_points ?? null,
      underwriting_fee: details?.underwriting_fee ?? null,
      legal_doc_prep_fee: details?.legal_doc_prep_fee ?? null,
      desk_review_fee: details?.desk_review_fee ?? null,
      small_balance_fee: details?.small_balance_fee ?? null,
      feasibility_fee: details?.feasibility_fee ?? null,
      construction_holdback: details?.construction_holdback ?? null,
      draw_fee: details?.draw_fee ?? null,
      initial_loan_amount: details?.initial_loan_amount ?? null,
      purchase_price: details?.purchase_price ?? null,
      property_street: details?.property_street ?? null,
      property_city: details?.property_city ?? null,
      property_state: details?.property_state ?? null,
      property_zip: details?.property_zip ?? null,
      additional_fees: details?.additional_fees ?? null,
      additional_fees_notes: details?.additional_fees_notes ?? null,
    },
    borrower,
    coBorrowerNames,
    esignTags: true,
  })

  const loanName = formatLoanName({
    borrowerName: borrower.full_name,
    propertyAddress: loan.property_address,
  })

  let documentId: string
  try {
    const result = await sendForSignature({
      title: `Loan Term Sheet — ${loanName}`,
      message:
        'Please review and sign the attached Loan Term Sheet from First Equity Funding. ' +
        'You can also sign directly in your borrower portal.',
      pdf,
      signerName: borrower.full_name,
      signerEmail: borrower.email,
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
      signer_name: borrower.full_name,
      signer_email: borrower.email,
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
    description: `Term Sheet sent for e-signature to ${borrower.full_name} (${borrower.email}) by ${staff.name ?? staff.role}`,
  })

  return NextResponse.json({ ok: true, envelopeId: envelope.id, documentId })
}
