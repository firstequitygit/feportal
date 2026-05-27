import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type Loan, type Condition, type Document } from '@/lib/types'
import { LoanProgressTracker } from '@/components/loan-progress-tracker'
import { LoanRealtimeRefresh } from '@/components/loan-realtime-refresh'
import { PortalShell } from '@/components/portal-shell'
import { ConditionsList } from '@/components/conditions-list'
import { LoanActivity } from '@/components/loan-activity'
import { formatDate } from '@/lib/format-date'
import { formatInterestRate } from '@/lib/format-interest-rate'
import { resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function formatPercent(val: number | null): string {
  if (val === null) return '—'
  return `${val}%`
}

export default async function LoanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // "View as borrower" support — see src/lib/impersonate.ts.
  // loanIdForAccessCheck enables LO/LP impersonation (admin works everywhere).
  const adminClient = createAdminClient()
  const impersonation = await resolveImpersonation(adminClient, user.id, sp, { loanIdForAccessCheck: id })
  const isImpersonating = impersonation?.kind === 'borrower'

  // Load the borrower row — either the signed-in borrower, or the
  // impersonated one when an admin is previewing.
  const borrowerQuery = isImpersonating
    ? adminClient.from('borrowers').select('*').eq('id', impersonation.id).single()
    : supabase.from('borrowers').select('*').eq('auth_user_id', user.id).single()
  const { data: borrower } = await borrowerQuery

  if (!borrower) redirect('/login')

  // Cookie-based impersonation (global View-As) enforces slot membership —
  // admin can ONLY view loans the impersonated borrower is actually on.
  // Query-param impersonation (legacy per-loan dropdown) preserves the
  // historical "admin chose the loan deliberately" permissive behavior.
  const enforceSlot = !isImpersonating || impersonation?.source === 'cookie'
  const loanQuery = enforceSlot
    ? (isImpersonating ? adminClient : supabase).from('loans').select('*')
        .eq('id', id)
        .or(`borrower_id.eq.${borrower.id},borrower_id_2.eq.${borrower.id},borrower_id_3.eq.${borrower.id},borrower_id_4.eq.${borrower.id}`)
        .single()
    : adminClient.from('loans').select('*').eq('id', id).single()
  const { data: loan } = await loanQuery

  if (!loan) notFound()

  // Fetch loan officer + loan processor via admin client (already created above)
  const lpIds = [loan.loan_processor_id, loan.loan_processor_id_2].filter((id): id is string => !!id)
  const [loanOfficer, lpRows] = await Promise.all([
    loan.loan_officer_id
      ? adminClient.from('loan_officers').select('full_name, email, phone, title').eq('id', loan.loan_officer_id).single().then(({ data }) => data)
      : null,
    lpIds.length > 0
      ? adminClient.from('loan_processors').select('id, full_name, email, phone, title').in('id', lpIds).then(({ data }) => data)
      : null,
  ])
  // Preserve order: slot 1 first, slot 2 second
  const loanProcessors = lpIds
    .map(id => (lpRows ?? []).find(r => r.id === id))
    .filter((r): r is { id: string; full_name: string; email: string | null; phone: string | null; title: string | null } => !!r)

  // Use adminClient (service role) for these reads now that the borrower's
  // access to the loan has been verified above. The previous supabase (anon)
  // client was RLS-gated, which broke admin impersonation — RLS saw the admin
  // user, not the borrower, so 0 conditions/documents/events came back. The
  // broker page already used adminClient for the same reason.
  const { data: conditions } = await adminClient
    .from('conditions')
    .select('*')
    .eq('loan_id', loan.id)
    .order('created_at', { ascending: true })

  const { data: documents } = await adminClient
    .from('documents')
    .select('*')
    .eq('loan_id', loan.id)
    .order('created_at', { ascending: false })

  // Generate signed download URLs so the borrower can fetch docs attached to their conditions
  const signedUrlMap: Record<string, string> = {}
  await Promise.all(
    (documents ?? []).map(async doc => {
      const { data } = await adminClient.storage.from('documents').createSignedUrl(doc.file_path, 3600)
      if (data?.signedUrl) signedUrlMap[doc.id] = data.signedUrl
    })
  )

  const { data: events } = await adminClient
    .from('loan_events')
    .select('*')
    .eq('loan_id', loan.id)
    .order('created_at', { ascending: false })

  return (
    <PortalShell
      userName={borrower.full_name ?? user.email ?? null}
      userRole="Borrower"
      dashboardHref="/dashboard"
      impersonation={isImpersonating && impersonation ? {
        kind: 'borrower',
        name: borrower.full_name,
        exitHref: impersonationExitHref(loan.id, impersonation.impersonatorRole),
      } : null}
    >
        <LoanRealtimeRefresh loanId={loan.id} />
        {/* Back link */}
        <Link href="/dashboard" className="text-sm text-primary hover:opacity-80 mb-4 inline-block">
          ← Back to My Loans
        </Link>

        {/* Property title */}
        <h2 className="text-2xl font-bold text-gray-900 mt-2 mb-6">
          {loan.property_address ?? 'Loan Details'}
        </h2>

        <LoanProgressTracker
          stage={loan.pipeline_stage}
          fundedMessage="Your loan has been funded — congratulations!"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Loan Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Loan Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loan.pipeline_stage === 'Closed' && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Status</span>
                  <span className="font-semibold text-green-600">Closed &amp; Funded ✓</span>
                </div>
              )}
              {[
                { label: 'Loan Number',          value: loan.loan_number ?? '—' },
                { label: 'Loan Type',            value: loan.loan_type ?? '—' },
                { label: 'Loan Amount',          value: formatCurrency(loan.loan_amount) },
                { label: 'Interest Rate',        value: formatInterestRate(loan.interest_rate) },
                { label: 'Interest Only',        value: loan.interest_only ?? '—' },
                { label: 'Rate Locked / Days',   value: loan.rate_locked_days ?? '—' },
                { label: 'Rate Lock Expiration', value: formatDate(loan.rate_lock_expiration_date) },
                { label: 'LTV',                  value: formatPercent(loan.ltv) },
                { label: 'Term',                 value: loan.term_months ? `${loan.term_months} months` : '—' },
                { label: 'Est. Closing Date',    value: formatDate(loan.estimated_closing_date) },
                { label: 'Origination Date',     value: formatDate(loan.origination_date) },
                { label: 'Maturity Date',        value: formatDate(loan.maturity_date) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-gray-900">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Right column: Property Details + Loan Officer */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Property Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: 'Property Address', value: loan.property_address ?? '—' },
                  { label: 'Borrowing Entity',  value: loan.entity_name ?? '—' },
                  { label: 'ARV',               value: formatCurrency(loan.arv) },
                  { label: 'Construction Budget', value: formatCurrency(loan.rehab_budget) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-medium text-gray-900">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Loan Officer */}
            {loanOfficer && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Your Loan Officer</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="font-medium text-gray-900">{loanOfficer.full_name}</p>
                  {loanOfficer.title && <p className="text-gray-500">{loanOfficer.title}</p>}
                  {loanOfficer.email && (
                    <p className="text-gray-500">
                      ✉ <a href={`mailto:${loanOfficer.email}`} className="text-primary hover:opacity-80">{loanOfficer.email}</a>
                    </p>
                  )}
                  {loanOfficer.phone && (
                    <p className="text-gray-500">
                      📞 <a href={`tel:${loanOfficer.phone}`} className="text-primary hover:opacity-80">{loanOfficer.phone}</a>
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Loan Processor(s) */}
            {loanProcessors.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{loanProcessors.length > 1 ? 'Your Loan Processors' : 'Your Loan Processor'}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {loanProcessors.map((lp, i) => (
                    <div key={lp.id} className={`space-y-1 ${i > 0 ? 'pt-3 border-t border-gray-100' : ''}`}>
                      <p className="font-medium text-gray-900">{lp.full_name}</p>
                      {lp.title && <p className="text-gray-500">{lp.title}</p>}
                      {lp.email && (
                        <p className="text-gray-500">
                          ✉ <a href={`mailto:${lp.email}`} className="text-primary hover:opacity-80">{lp.email}</a>
                        </p>
                      )}
                      {lp.phone && (
                        <p className="text-gray-500">
                          📞 <a href={`tel:${lp.phone}`} className="text-primary hover:opacity-80">{lp.phone}</a>
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Conditions */}
        <ConditionsList
          loanId={loan.id}
          propertyAddress={loan.property_address ?? null}
          conditions={(conditions ?? []) as Condition[]}
          documents={(documents ?? []) as Document[]}
          signedUrlMap={signedUrlMap}
        />

        {/* Recent Activity */}
        {events && events.length > 0 && (
          <div className="mt-6">
            <LoanActivity events={events} title="Recent Activity" hideStaffNames />
          </div>
        )}
    </PortalShell>
  )
}
