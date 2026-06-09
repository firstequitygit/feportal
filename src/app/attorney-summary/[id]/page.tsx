// Attorney Submission Summary generator. Single-page form the UW
// hands to the closing attorney. Most fields populate from Loan
// Details / Loan Summary; Miscellaneous Notes is editable in the
// browser before printing.

import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AttorneySubmissionSummary } from '@/components/attorney-submission-summary'

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

export default async function AttorneySummaryPage({ params }: { params: Promise<{ id: string }> }) {
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
      property_address, loan_number, loan_type, term_months, entity_name, estimated_closing_date,
      borrowers!borrower_id(full_name),
      borrower_2:borrowers!borrower_id_2(full_name),
      borrower_3:borrowers!borrower_id_3(full_name),
      borrower_4:borrowers!borrower_id_4(full_name)
    `)
    .eq('id', id)
    .single()

  if (!loan) notFound()

  const { data: details } = await adminClient
    .from('loan_details')
    .select('title_company, title_contact_name, underwriter_notes')
    .eq('loan_id', id)
    .maybeSingle()

  const borrower = loan.borrowers as unknown as { full_name: string | null } | null
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

  return (
    <AttorneySubmissionSummary
      propertyAddress={loan.property_address}
      loanNumber={loan.loan_number}
      loanType={loan.loan_type}
      termMonths={loan.term_months}
      borrowerName={borrower?.full_name ?? null}
      coBorrowerNames={coBorrowerNames}
      entityName={loan.entity_name}
      titleCompany={details?.title_company ?? null}
      titleContactName={details?.title_contact_name ?? null}
      estimatedClosingDate={loan.estimated_closing_date}
      initialNotes={details?.underwriter_notes ?? null}
      backHref={backHref}
    />
  )
}
