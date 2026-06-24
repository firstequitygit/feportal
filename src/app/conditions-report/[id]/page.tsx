// Printable Conditions List. Staff-gated (admin / LO / LP / UW).
// Renders every condition on the loan with its title, details,
// status, and internal staff notes, for printing to PDF.

import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ConditionsReport } from '@/components/conditions-report'
import { fetchConditionNotesForLoan } from '@/lib/fetch-condition-notes'
import { formatLoanName } from '@/lib/format-loan-name'
import { type Condition } from '@/lib/types'

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

export default async function ConditionsReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const staff = await getStaffRole(user.id)
  if (!staff) redirect('/dashboard')

  const adminClient = createAdminClient()

  const [{ data: loan }, { data: conditions }, notesByCondition] = await Promise.all([
    adminClient
      .from('loans')
      .select('property_address, loan_number, borrowers!borrower_id(full_name)')
      .eq('id', id)
      .single(),
    adminClient
      .from('conditions')
      .select('*')
      .eq('loan_id', id)
      .order('created_at', { ascending: true }),
    fetchConditionNotesForLoan(adminClient, id),
  ])

  if (!loan) notFound()

  const borrower = loan.borrowers as unknown as { full_name: string | null } | null
  const loanName = formatLoanName({
    borrowerName: borrower?.full_name ?? null,
    propertyAddress: loan.property_address,
    loanNumber: loan.loan_number,
  })

  const backHref =
    staff.role === 'Administrator'  ? `/admin/loans/${id}` :
    staff.role === 'Loan Officer'   ? `/loan-officer/loans/${id}` :
    staff.role === 'Loan Processor' ? `/loan-processor/loans/${id}` :
    /* Underwriter */                 `/underwriter/loans/${id}`

  return (
    <ConditionsReport
      loanId={id}
      loanName={loanName}
      loanNumber={loan.loan_number}
      propertyAddress={loan.property_address}
      conditions={(conditions ?? []) as Condition[]}
      notesByCondition={notesByCondition}
      backHref={backHref}
    />
  )
}
