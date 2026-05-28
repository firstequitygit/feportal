import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata = { title: 'Loan Application - Authorization' }

/** Public token-auth route. Borrower lands here after the application is
 *  submitted (PR 2b will redirect from the wizard; today the route is
 *  reachable only via a direct token URL). Resolves the token to a loans
 *  row, displays the loan summary, and — in PR 2b — will render the credit
 *  authorization, HMDA disclosures, and Square card form. */
export default async function AuthorizePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) notFound()

  const admin = createAdminClient()
  const { data: loan } = await admin
    .from('loans')
    .select(`
      id, property_address, loan_type, loan_amount, application_kind,
      authorization_status, authorization_signed_at, authorize_token,
      borrower_id
    `)
    .eq('authorize_token', token)
    .maybeSingle()

  if (!loan) notFound()

  const { data: borrower } = loan.borrower_id
    ? await admin.from('borrowers').select('full_name, email').eq('id', loan.borrower_id).maybeSingle()
    : { data: null }

  const alreadySigned = loan.authorization_status === 'signed'

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-[#1F5D8F]">
          {alreadySigned ? 'Authorization Complete' : 'Authorize Your Application'}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {alreadySigned
            ? 'Your authorization has been received. Our team will reach out with next steps.'
            : 'Review your application details below and complete the authorization step to move your loan forward.'}
        </p>

        <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {borrower?.full_name && (
            <div>
              <dt className="text-gray-500">Borrower</dt>
              <dd className="font-medium text-gray-900">{borrower.full_name}</dd>
            </div>
          )}
          {loan.property_address && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Property</dt>
              <dd className="font-medium text-gray-900">{loan.property_address}</dd>
            </div>
          )}
          {loan.loan_type && (
            <div>
              <dt className="text-gray-500">Loan Type</dt>
              <dd className="font-medium text-gray-900">{loan.loan_type}</dd>
            </div>
          )}
          {loan.loan_amount != null && (
            <div>
              <dt className="text-gray-500">Loan Amount</dt>
              <dd className="font-medium text-gray-900">
                ${Number(loan.loan_amount).toLocaleString()}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Status</dt>
            <dd className="font-medium text-gray-900 capitalize">
              {loan.authorization_status ?? 'unknown'}
            </dd>
          </div>
        </dl>

        {!alreadySigned && (
          <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Authorization form coming soon.</p>
            <p className="mt-1 text-amber-800">
              We're finalizing the credit authorization, demographic disclosure, and payment
              screen on this page. For now, please continue with the steps your loan officer
              has provided. If you reached this page in error, you can safely close the tab.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
