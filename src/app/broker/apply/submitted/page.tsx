import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'
import { CopyLinkButton } from './_components/copy-link-button'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata = { title: 'Application submitted - First Equity Funding' }

const FALLBACK_PORTAL_URL = 'https://firstequity.irongateportals.com'

export default async function BrokerApplySubmittedPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const sp = await searchParams
  const impersonation = await resolveImpersonation(admin, user.id, sp)
  const isImpersonating = impersonation?.kind === 'broker'

  const { data: broker } = isImpersonating
    ? await admin.from('brokers').select('*').eq('id', impersonation.id).maybeSingle()
    : await admin.from('brokers').select('*').eq('auth_user_id', user.id).maybeSingle()
  if (!broker) redirect('/login')

  const tokenParam = sp.token
  const token = typeof tokenParam === 'string' ? tokenParam : null
  if (!token) notFound()

  const { data: loan } = await admin
    .from('loans')
    .select('id, property_address, submitted_by_broker_id, authorize_token, borrowers!borrower_id(full_name, email)')
    .eq('authorize_token', token)
    .maybeSingle()
  if (!loan || loan.submitted_by_broker_id !== broker.id) notFound()

  const borrower = loan.borrowers as unknown as { full_name: string | null; email: string | null } | null
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL ?? FALLBACK_PORTAL_URL
  const authorizeUrl = `${portalUrl}/authorize/${token}`

  const subject = encodeURIComponent('Please complete your loan authorization')
  const body = encodeURIComponent(
    `Hi ${borrower?.full_name?.split(' ')[0] ?? 'there'},\n\n` +
    `I've submitted your loan application to First Equity Funding. To finish, please complete the credit authorization and pay the application fee at the secure link below:\n\n` +
    `${authorizeUrl}\n\n` +
    `Thanks,\n${broker.full_name ?? broker.email}`,
  )
  const mailto = borrower?.email
    ? `mailto:${borrower.email}?subject=${subject}&body=${body}`
    : `mailto:?subject=${subject}&body=${body}`

  return (
    <PortalShell
      userName={broker.full_name ?? broker.email}
      userRole="Broker"
      dashboardHref="/broker"
      variant="broker"
      impersonation={isImpersonating ? {
        kind: 'broker',
        name: broker.full_name,
        exitHref: impersonationExitHref(),
      } : null}
    >
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">
            Application submitted - ready for borrower
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            We've created the loan{loan.property_address ? <> for <strong className="font-medium text-gray-900">{loan.property_address}</strong></> : null}.
            The borrower still needs to complete the credit authorization and pay the application fee.
            Forward the secure link below to {borrower?.full_name ?? 'the borrower'} so they can finish.
          </p>

          <div className="mt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Borrower authorization link</p>
            <code className="mt-1 block break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
              {authorizeUrl}
            </code>
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyLinkButton url={authorizeUrl} />
              <a
                href={mailto}
                className="inline-flex h-9 items-center rounded-md bg-[#1F5D8F] px-4 text-sm font-medium text-white transition-colors hover:bg-[#0F3A5E]"
              >
                Email link to borrower
              </a>
            </div>
          </div>

          <hr className="my-6 border-gray-100" />

          <Link href="/broker" className="text-sm font-medium text-[#1F5D8F] hover:underline">
            Return to dashboard
          </Link>
        </div>
      </div>
    </PortalShell>
  )
}
