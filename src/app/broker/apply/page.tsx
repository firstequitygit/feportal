import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Wizard } from '@/app/apply/_components/wizard'

export const metadata = { title: 'Broker Application - First Equity Funding' }

async function fetchLoanOfficerOptions(): Promise<string[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('loan_officers')
      .select('full_name')
      .order('full_name')
    const names = (data ?? [])
      .map((lo) => (lo.full_name as string | null) ?? '')
      .filter((n) => n.trim().length > 0)
    return [...names, 'Other']
  } catch {
    return ['Other']
  }
}

// Admin detection is best-effort. The broker route is public, so an
// unauthenticated visitor just gets isAdmin=false (no test mode toggle).
async function checkIsAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

export default async function BrokerApplyPage() {
  const [isAdmin, loanOfficerOptions] = await Promise.all([
    checkIsAdmin(),
    fetchLoanOfficerOptions(),
  ])
  return (
    <Suspense>
      <Wizard
        initialData={{}}
        initialStep={1}
        initialToken={null}
        isAdmin={isAdmin}
        loanOfficerOptions={loanOfficerOptions}
        variantKind="broker"
      />
    </Suspense>
  )
}
