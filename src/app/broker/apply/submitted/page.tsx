import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { CopyLinkButton } from './_components/copy-link-button'
import { PORTAL_URL } from '@/lib/portal-url'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata = { title: 'Submitted - Broker Application' }

// Public confirmation page. The ?token= URL param is the auth — anyone who
// has the token (i.e. the broker who just submitted) can see this page.
// Without the token we 404.
export default async function BrokerSubmittedPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const token = typeof sp.token === 'string' ? sp.token : null
  if (!token) notFound()

  const admin = createAdminClient()
  const { data: loan } = await admin
    .from('loans')
    .select('id, application_kind, authorize_token, property_address, borrower_id')
    .eq('authorize_token', token)
    .maybeSingle()
  if (!loan || loan.application_kind !== 'broker') notFound()

  const { data: borrower } = loan.borrower_id
    ? await admin.from('borrowers').select('full_name').eq('id', loan.borrower_id).maybeSingle()
    : { data: null }

  const authorizeUrl = `${PORTAL_URL}/authorize/${token}`
  const borrowerName = (borrower as { full_name: string | null } | null)?.full_name ?? 'your borrower'
  const propertyAddress = loan.property_address ?? 'the property'

  const mailtoSubject = encodeURIComponent('Action needed: complete your loan authorization')
  const mailtoBody = encodeURIComponent(
    `Hi,\n\nWe submitted a loan application for ${propertyAddress} on your behalf. ` +
    `To move forward, please complete the credit and identity authorization at the link below:\n\n${authorizeUrl}\n\n` +
    `This is a secure form hosted by First Equity Funding.\n\nThanks.`
  )

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-[#1F5D8F]">Application submitted</h1>
        <p className="mt-2 text-sm text-gray-600">
          Forward the secure link below to {borrowerName}. They will complete the credit
          authorization and save a card on file to finish the application.
        </p>

        <div className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Borrower authorization link</p>
          <p className="mt-1 break-all font-mono text-sm text-gray-900">{authorizeUrl}</p>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <CopyLinkButton url={authorizeUrl} />
          <a
            href={`mailto:?subject=${mailtoSubject}&body=${mailtoBody}`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-gray-300 px-5 text-sm text-gray-700 transition-colors hover:border-gray-400"
          >
            Email link to borrower
          </a>
        </div>

        <div className="mt-8 border-t border-gray-200 pt-6 text-sm text-gray-600">
          <p>Once the borrower completes the form, our team will review the application and reach out.</p>
          <p className="mt-2">
            <Link href="/broker/apply" className="text-[#1F5D8F] underline hover:text-[#0F3A5E]">
              Submit another application
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
