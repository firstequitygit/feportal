import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminLoanProcessorsManager } from '@/components/admin-loan-processors-manager'
import { type LoanProcessor } from '@/lib/types'

export default async function LoanProcessorsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const { data: loanProcessors } = await createAdminClient()
    .from('loan_processors')
    .select('*')
    .order('full_name')

  return (
    <>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Loan Processors</h3>
      <AdminLoanProcessorsManager initialLoanProcessors={(loanProcessors ?? []) as LoanProcessor[]} />
    </>
  )
}
