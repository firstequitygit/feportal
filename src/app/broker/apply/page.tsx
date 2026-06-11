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

// When the form runs inside the WordPress iframe, the admin session cookie is
// third-party and never arrives, so checkIsAdmin() can't see it. A secret
// ?testkey=<BROKER_EMBED_TEST_KEY> in the embed URL unlocks test mode without a
// cookie. The matching API route (test-submit) honors the same secret as a
// header. Keep the secret URL off public pages.
function embedTestUnlocked(testKey: string | null): boolean {
  const envKey = process.env.BROKER_EMBED_TEST_KEY ?? ''
  return envKey.length > 0 && testKey === envKey
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
  const isAdmin = realAdmin || embedTestUnlocked(testKey)
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
