import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { feeCentsForBorrowerCount } from '@/lib/square'
import { AuthorizeForm } from './_components/authorize-form'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata = { title: 'Loan Application - Authorization' }

/** Public token-auth route. Borrower lands here after a broker submits an
 *  application on their behalf (the broker forwards the token URL). Today's
 *  borrower flow still signs + pays inline at Step 5 — they do not hit this
 *  page. The redirect cutover for the borrower variant lives in a separate
 *  follow-up so existing in-flight drafts aren't disrupted. */
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

  // Determine borrower count via loan_applications.data.co_borrowers so the
  // fee summary matches what /api/apply/payment would compute.
  const { data: app } = await admin
    .from('loan_applications')
    .select('data')
    .eq('submitted_loan_id', loan.id)
    .maybeSingle()
  const cobs = Array.isArray((app?.data as { co_borrowers?: unknown[] })?.co_borrowers)
    ? (app!.data as { co_borrowers: unknown[] }).co_borrowers
    : []
  const borrowerCount = 1 + cobs.length
  const feeUsd = feeCentsForBorrowerCount(borrowerCount) / 100

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
            : 'Review the certifications below, sign electronically, and save the card we will use for your application fee.'}
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
              <dd className="font-medium text-gray-900">${Number(loan.loan_amount).toLocaleString()}</dd>
            </div>
          )}
        </dl>

        <div className="mt-8">
          {alreadySigned ? (
            <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              Authorized on {loan.authorization_signed_at ? new Date(loan.authorization_signed_at).toLocaleDateString() : 'file'}.
              You can safely close this tab.
            </div>
          ) : (
            <AuthorizeForm
              token={token}
              borrowerName={borrower?.full_name ?? ''}
              feeUsd={feeUsd}
              borrowerCount={borrowerCount}
            />
          )}
        </div>
      </div>
    </div>
  )
}
