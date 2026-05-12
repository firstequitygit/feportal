import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminLoanProcessorsManager } from '@/components/admin-loan-processors-manager'
import { type LoanProcessor } from '@/lib/types'

export default async function LoanProcessorsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const { data: loanProcessors } = await createAdminClient()
    .from('loan_processors')
    .select('*')
    .order('full_name')

  return (
    <PortalShell userName={null} userRole="Administrator" dashboardHref="/admin" variant="admin" maxWidth="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Loan Processors</h2>
      <AdminLoanProcessorsManager initialLoanProcessors={(loanProcessors ?? []) as LoanProcessor[]} />
    </PortalShell>
  )
}
