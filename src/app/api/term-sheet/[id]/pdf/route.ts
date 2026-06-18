// Server-rendered Term Sheet PDF. Returns a real downloadable PDF
// (vs. the browser print dialog) so font rendering stays clean —
// printing the HTML version was mangling lowercase "l"s in Chrome's
// PDF export.
//
// Any authenticated staff role can download. Borrowers + brokers
// don't get term-sheet access (matches the existing /term-sheet/[id]
// HTML page).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderTermSheetPdf } from '@/lib/pdf/term-sheet-pdf'

export const runtime = 'nodejs'

async function isStaff(authUserId: string): Promise<boolean> {
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
  return !!(adminUser || lo || lp || uw)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isStaff(user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select(`
      *,
      borrowers!borrower_id(full_name, current_address_street, current_address_city, current_address_state, current_address_zip),
      borrower_2:borrowers!borrower_id_2(full_name),
      borrower_3:borrowers!borrower_id_3(full_name),
      borrower_4:borrowers!borrower_id_4(full_name)
    `)
    .eq('id', id)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

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
    // Logo only on borrower-only loans; broker-assigned term sheets
    // go out without FE branding.
    showLogo: !(loan.broker_id || loan.broker_id_2),
  })

  // Filename uses the loan name so the downloaded file is easy to
  // file/identify on the UW's machine.
  const safeFileSeed =
    (borrower?.full_name ?? loan.entity_name ?? loan.loan_number ?? id)
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '_')
  const filename = `Term_Sheet_${safeFileSeed || 'loan'}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
