import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminLoanOfficersManager } from '@/components/admin-loan-officers-manager'
import { type LoanOfficer } from '@/lib/types'

export default async function LoanOfficersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const { data: loanOfficers } = await createAdminClient()
    .from('loan_officers')
    .select('*')
    .order('full_name')

  return (
    <AdminLoanOfficersManager initialLoanOfficers={(loanOfficers ?? []) as LoanOfficer[]} />
  )
}
