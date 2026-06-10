// Loan Term Sheet generator. Auto-picks DSCR vs Fix&Flip appendix
// based on loan_type. UW prints to PDF via the browser print
// dialog (same flow as the Approval Letter and Committee Review).

import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TermSheet } from '@/components/term-sheet'
import { isEsignEnabled } from '@/lib/esign/boldsign'

type StaffRole = 'Administrator' | 'Loan Officer' | 'Loan Processor' | 'Underwriter'

async function getStaffRole(authUserId: string): Promise<{ role: StaffRole } | null> {
  const adminClient = createAdminClient()
  const [
    { data: adminUser },
    { data: lo },
    { data: lp },
    { data: uw },
  ] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', authUserId).maybeSingle(),
  ])
  if (adminUser) return { role: 'Administrator' }
  if (lo) return { role: 'Loan Officer' }
  if (lp) return { role: 'Loan Processor' }
  if (uw) return { role: 'Underwriter' }
  return null
}

export default async function TermSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const staff = await getStaffRole(user.id)
  if (!staff) redirect('/dashboard')

  const adminClient = createAdminClient()

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

  if (!loan) notFound()

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

  const borrower = loan.borrowers as unknown as {
    full_name: string | null
    email: string | null
    current_address_street: string | null
    current_address_city: string | null
    current_address_state: string | null
    current_address_zip: string | null
  } | null
  const co1 = (loan as unknown as { borrower_2: { full_name: string | null } | null }).borrower_2
  const co2 = (loan as unknown as { borrower_3: { full_name: string | null } | null }).borrower_3
  const co3 = (loan as unknown as { borrower_4: { full_name: string | null } | null }).borrower_4

  const coBorrowerNames = [co1?.full_name, co2?.full_name, co3?.full_name]
    .filter((x): x is string => !!x)

  const backHref =
    staff.role === 'Administrator'    ? `/admin/loans/${id}` :
    staff.role === 'Loan Officer'     ? `/loan-officer/loans/${id}` :
    staff.role === 'Loan Processor'   ? `/loan-processor/loans/${id}` :
    /* Underwriter */                   `/underwriter/loans/${id}`

  // Latest e-sign envelope status for the toolbar pill / send button.
  // Best-effort: hidden entirely when BoldSign isn't configured, and
  // tolerant of the esign_envelopes table not existing yet.
  const esignEnabled = isEsignEnabled()
  let esignStatus: string | null = null
  if (esignEnabled) {
    try {
      const { data: env } = await adminClient
        .from('esign_envelopes')
        .select('status')
        .eq('loan_id', id)
        .eq('document_kind', 'term_sheet')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      esignStatus = env?.status ?? null
    } catch {
      // table missing — treat as never sent
    }
  }

  return (
    <TermSheet
      loanId={id}
      loan={{
        loan_type: loan.loan_type,
        loan_amount: loan.loan_amount,
        interest_rate: loan.interest_rate,
        term_months: loan.term_months,
        interest_only: loan.interest_only,
        arv: loan.arv,
        rehab_budget: loan.rehab_budget,
        entity_name: loan.entity_name,
        property_address: loan.property_address,
      }}
      details={{
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
      }}
      borrower={borrower}
      coBorrowerNames={coBorrowerNames}
      backHref={backHref}
      esign={{
        enabled: esignEnabled,
        status: esignStatus,
        signerHasEmail: !!borrower?.email,
      }}
    />
  )
}
