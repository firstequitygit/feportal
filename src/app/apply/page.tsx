import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Wizard } from './_components/wizard'
import { ApplyGate } from './_components/apply-gate'
import { loadBorrowerPrefill } from '@/lib/application/prefill'
import { isValidEmbedTestKey } from '@/lib/application/embed-test'
import type { ApplicationData } from '@/lib/application-fields'

export const metadata = { title: 'Loan Application - First Equity Funding' }

async function checkIsAdmin(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', userId)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

async function fetchBorrowerByAuthId(userId: string): Promise<{ id: string; email: string } | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('borrowers')
      .select('id, email')
      .eq('auth_user_id', userId)
      .maybeSingle()
    return data && data.email ? { id: data.id as string, email: data.email as string } : null
  } catch {
    return null
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

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const testKey = typeof sp.testkey === 'string' ? sp.testkey : null
  // Embed mode: the WordPress iframe is cross-site/unauthenticated. A valid
  // testkey is the admin embed-test path (straight to the form, test mode).
  // Public ?embed=1 now shows the chooser like the standalone page does.
  const embedTest = isValidEmbedTestKey(testKey)
  const isEmbed = sp.embed === '1' || embedTest

  const loanOfficerOptions = await fetchLoanOfficerOptions()

  // Who is asking?
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Case 1: authenticated borrower (not in embed) -> pre-filled wizard. This is
  // the ONLY way a logged-in borrower can reach the form, so they can never get
  // a blank application.
  if (user && !isEmbed) {
    const borrower = await fetchBorrowerByAuthId(user.id)
    if (borrower) {
      const initialData: ApplicationData = await loadBorrowerPrefill(borrower.email)
      return (
        <Suspense>
          <Wizard
            initialData={initialData}
            initialStep={1}
            initialToken={null}
            isAdmin={false}
            loanOfficerOptions={loanOfficerOptions}
            variantKind="borrower"
            authenticated
          />
        </Suspense>
      )
    }
    // Case 2a: authenticated admin -> blank form with test mode (preserves
    // current admin access to /apply for testing). Other staff fall through to
    // the chooser.
    const isAdmin = await checkIsAdmin(user.id)
    if (isAdmin) {
      return (
        <Suspense>
          <Wizard
            initialData={{}}
            initialStep={1}
            initialToken={null}
            isAdmin
            loanOfficerOptions={loanOfficerOptions}
            variantKind="borrower"
          />
        </Suspense>
      )
    }
  }

  // Case 2b: admin embed test (valid testkey) -> blank form with test mode, so
  // admins can run a test submission from inside the live WordPress iframe.
  if (embedTest) {
    return (
      <Suspense>
        <Wizard
          initialData={{}}
          initialStep={1}
          initialToken={null}
          isAdmin
          loanOfficerOptions={loanOfficerOptions}
          variantKind="borrower"
        />
      </Suspense>
    )
  }

  // Case 3: the new-vs-returning chooser. Shown both standalone and embedded.
  // In an embed (?embed=1) the returning path breaks out to the portal to sign
  // in, because auth cookies do not work inside a cross-site iframe.
  return (
    <Suspense>
      <ApplyGate loanOfficerOptions={loanOfficerOptions} embed={sp.embed === '1'} />
    </Suspense>
  )
}
