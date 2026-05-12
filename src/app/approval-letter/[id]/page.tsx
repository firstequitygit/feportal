import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ApprovalLetter } from '@/components/approval-letter'
import { type Condition } from '@/lib/types'

type StaffRole = 'Administrator' | 'Loan Officer' | 'Loan Processor' | 'Underwriter'

async function getStaffRole(authUserId: string): Promise<{ role: StaffRole; name: string | null } | null> {
  const adminClient = createAdminClient()
  const [
    { data: adminUser },
    { data: lo },
    { data: lp },
    { data: uw },
  ] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_officers').select('full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_processors').select('full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('underwriters').select('full_name').eq('auth_user_id', authUserId).maybeSingle(),
  ])
  if (adminUser) return { role: 'Administrator', name: null }
  if (lo) return { role: 'Loan Officer', name: lo.full_name }
  if (lp) return { role: 'Loan Processor', name: lp.full_name }
  if (uw) return { role: 'Underwriter', name: uw.full_name }
  return null
}

export default async function ApprovalLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const staff = await getStaffRole(user.id)
  if (!staff) redirect('/dashboard')

  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select('*, borrowers(full_name, email, entity_name), loan_officers(full_name, email, phone, title)')
    .eq('id', id)
    .single()

  if (!loan) notFound()

  const { data: conditions } = await adminClient
    .from('conditions')
    .select('*')
    .eq('loan_id', id)
    .in('status', ['Outstanding', 'Rejected'])
    .order('created_at', { ascending: true })

  const borrower = loan.borrowers as { full_name: string | null; email: string; entity_name: string | null } | null
  const loanOfficer = loan.loan_officers as unknown as { full_name: string; email: string | null; phone: string | null; title: string | null } | null

  // Staff can see the letter regardless of which loan it is — admins always,
  // and LO/LP/UW even for loans not assigned to them (matches "all staff" rule).
  const backHref =
    staff.role === 'Administrator'    ? `/admin/loans/${id}` :
    staff.role === 'Loan Officer'     ? `/loan-officer/loans/${id}` :
    staff.role === 'Loan Processor'   ? `/loan-processor/loans/${id}` :
    /* Underwriter */                   `/underwriter/loans/${id}`

  return (
    <ApprovalLetter
      loan={{
        property_address: loan.property_address,
        loan_amount: loan.loan_amount,
        interest_rate: loan.interest_rate,
        ltv: loan.ltv,
        arv: loan.arv,
        rehab_budget: loan.rehab_budget,
        term_months: loan.term_months,
        loan_type: loan.loan_type,
        entity_name: loan.entity_name,
        loan_number: loan.loan_number,
        estimated_closing_date: loan.estimated_closing_date,
      }}
      borrower={borrower}
      loanOfficer={loanOfficer}
      conditions={(conditions ?? []) as Condition[]}
      backHref={backHref}
    />
  )
}
