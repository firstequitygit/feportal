import { Suspense } from 'react'
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

export default async function BrokerApplyPage() {
  const loanOfficerOptions = await fetchLoanOfficerOptions()
  return (
    <Suspense>
      <Wizard
        initialData={{}}
        initialStep={1}
        initialToken={null}
        loanOfficerOptions={loanOfficerOptions}
        variantKind="broker"
      />
    </Suspense>
  )
}
