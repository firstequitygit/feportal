import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Wizard } from '@/app/apply/_components/wizard'
import { isValidEmbedTestKey } from '@/lib/application/embed-test'

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

export default async function BrokerApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const testKey = typeof sp.testkey === 'string' ? sp.testkey : null
  const [realAdmin, loanOfficerOptions] = await Promise.all([
    checkIsAdmin(),
    fetchLoanOfficerOptions(),
  ])
  // Inside the WordPress iframe the admin cookie is third-party and never
  // arrives, so checkIsAdmin() can't see it. A matching ?testkey unlocks test
  // mode without a cookie. See lib/application/embed-test.
  const isAdmin = realAdmin || isValidEmbedTestKey(testKey)
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
