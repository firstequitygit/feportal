// Committee Review Sheet generator. Renders an HTML doc that the UW
// prints to PDF via the browser's print dialog (same pattern as the
// Conditional Approval Letter). The component auto-picks between the
// DSCR and Fix&Flip layouts based on loan_type.

import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CommitteeReviewSheet } from '@/components/committee-review-sheet'

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

export default async function CommitteeReviewPage({ params }: { params: Promise<{ id: string }> }) {
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
      borrowers!borrower_id(full_name),
      borrower_2:borrowers!borrower_id_2(full_name),
      borrower_3:borrowers!borrower_id_3(full_name),
      borrower_4:borrowers!borrower_id_4(full_name),
      loan_officers!loan_officer_id(full_name),
      brokers!broker_id(full_name)
    `)
    .eq('id', id)
    .single()

  if (!loan) notFound()

  const { data: details } = await adminClient
    .from('loan_details')
    .select(`
      loan_type_one, credit_score, points, broker_points, purchase_price, value_as_is,
      initial_loan_amount, underwriting_fee, exceptions, qualifying_rent,
      annual_property_tax, annual_insurance_premium, annual_flood_insurance, annual_hoa_dues,
      amortization_schedule
    `)
    .eq('loan_id', id)
    .maybeSingle()

  const borrower = loan.borrowers as unknown as { full_name: string | null } | null
  const co1 = (loan as unknown as { borrower_2: { full_name: string | null } | null }).borrower_2
  const co2 = (loan as unknown as { borrower_3: { full_name: string | null } | null }).borrower_3
  const co3 = (loan as unknown as { borrower_4: { full_name: string | null } | null }).borrower_4
  const loanOfficer = loan.loan_officers as unknown as { full_name: string | null } | null
  const broker = loan.brokers as unknown as { full_name: string | null } | null

  const coBorrowerNames = [co1?.full_name, co2?.full_name, co3?.full_name]
    .filter((x): x is string => !!x)

  const backHref =
    staff.role === 'Administrator'    ? `/admin/loans/${id}` :
    staff.role === 'Loan Officer'     ? `/loan-officer/loans/${id}` :
    staff.role === 'Loan Processor'   ? `/loan-processor/loans/${id}` :
    /* Underwriter */                   `/underwriter/loans/${id}`

  return (
    <CommitteeReviewSheet
      loanId={id}
      loan={{
        loan_type: loan.loan_type,
        loan_number: loan.loan_number,
        loan_amount: loan.loan_amount,
        interest_rate: loan.interest_rate,
        arv: loan.arv,
        rehab_budget: loan.rehab_budget,
        term_months: loan.term_months,
        interest_only: loan.interest_only,
        entity_name: loan.entity_name,
        property_address: loan.property_address,
      }}
      details={{
        loan_type_one: details?.loan_type_one ?? null,
        credit_score: details?.credit_score ?? null,
        points: details?.points ?? null,
        broker_points: details?.broker_points ?? null,
        purchase_price: details?.purchase_price ?? null,
        value_as_is: details?.value_as_is ?? null,
        initial_loan_amount: details?.initial_loan_amount ?? null,
        underwriting_fee: details?.underwriting_fee ?? null,
        exceptions: details?.exceptions ?? null,
        qualifying_rent: details?.qualifying_rent ?? null,
        annual_property_tax: details?.annual_property_tax ?? null,
        annual_insurance_premium: details?.annual_insurance_premium ?? null,
        annual_flood_insurance: details?.annual_flood_insurance ?? null,
        annual_hoa_dues: details?.annual_hoa_dues ?? null,
        amortization_schedule: details?.amortization_schedule ?? null,
      }}
      borrowerName={borrower?.full_name ?? null}
      coBorrowerNames={coBorrowerNames}
      loanOfficerName={loanOfficer?.full_name ?? null}
      brokerName={broker?.full_name ?? null}
      backHref={backHref}
    />
  )
}
