import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { Wizard } from '../../_components/wizard'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata = { title: 'Resume Application' }

export default async function ResumePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const [{ data: app }, { data: los }] = await Promise.all([
    admin
      .from('loan_applications')
      .select('data, current_step, status')
      .eq('resume_token', token)
      .maybeSingle(),
    admin.from('loan_officers').select('full_name').order('full_name'),
  ])
  if (!app) notFound()
  if (app.status === 'submitted') {
    return (
      <div className="mx-auto max-w-xl p-12 text-center">
        <h1 className="text-2xl font-semibold text-[#1F5D8F]">Already submitted</h1>
        <p className="text-slate-600">This application has already been submitted.</p>
      </div>
    )
  }
  const loanOfficerOptions = [
    ...((los ?? []).map((lo) => (lo.full_name as string | null) ?? '').filter((n) => n.trim().length > 0)),
    'Other',
  ]
  return (
    <Suspense>
      <Wizard
        initialData={(app.data ?? {}) as Record<string, unknown>}
        initialStep={app.current_step ?? 1}
        initialToken={token}
        loanOfficerOptions={loanOfficerOptions}
      />
    </Suspense>
  )
}
