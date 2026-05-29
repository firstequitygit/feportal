import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Wizard } from './_components/wizard'

export const metadata = { title: 'Loan Application - First Equity Funding' }

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

export default async function ApplyPage() {
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
        variantKind="borrower"
      />
    </Suspense>
  )
}
