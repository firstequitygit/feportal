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

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function formatPercent(val: number | null): string {
  if (val === null) return '—'
  return `${val}%`
}

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: borrower } = await supabase
    .from('borrowers')
    .select('*')
    .eq('auth_user_id', user.id)
    .single()

  if (!borrower) redirect('/login')

  const { data: loan } = await supabase
    .from('loans')
    .select('*')
    .eq('id', id)
    .eq('borrower_id', borrower.id)
    .single()

  if (!loan) notFound()

  // Fetch loan officer + loan processor via admin client (bypasses RLS)
  const adminClient = createAdminClient()
  const [loanOfficer, loanProcessor] = await Promise.all([
    loan.loan_officer_id
      ? adminClient.from('loan_officers').select('full_name, email, phone, title').eq('id', loan.loan_officer_id).single().then(({ data }) => data)
      : null,
    loan.loan_processor_id
      ? adminClient.from('loan_processors').select('full_name, email, phone, title').eq('id', loan.loan_processor_id).single().then(({ data }) => data)
      : null,
  ])

  const { data: conditions } = await supabase
    .from('conditions')
    .select('*')
    .eq('loan_id', loan.id)
    .order('created_at', { ascending: true })

  const { data: documents } = await supabase
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

  const { data: events } = await supabase
    .from('loan_events')
    .select('*')
    .eq('loan_id', loan.id)
    .order('created_at', { ascending: false })

  return (
    <PortalShell userName={borrower.full_name ?? user.email ?? null} userRole="Borrower" dashboardHref="/dashboard">
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
                { label: 'Loan Type II',         value: loan.loan_type_ii ?? '—' },
                { label: 'Loan Amount',          value: formatCurrency(loan.loan_amount) },
                { label: 'Interest Rate',        value: formatPercent(loan.interest_rate) },
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

            {/* Loan Processor */}
            {loanProcessor && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Your Loan Processor</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="font-medium text-gray-900">{loanProcessor.full_name}</p>
                  {loanProcessor.title && <p className="text-gray-500">{loanProcessor.title}</p>}
                  {loanProcessor.email && (
                    <p className="text-gray-500">
                      ✉ <a href={`mailto:${loanProcessor.email}`} className="text-primary hover:opacity-80">{loanProcessor.email}</a>
                    </p>
                  )}
                  {loanProcessor.phone && (
                    <p className="text-gray-500">
                      📞 <a href={`tel:${loanProcessor.phone}`} className="text-primary hover:opacity-80">{loanProcessor.phone}</a>
                    </p>
                  )}
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
            <LoanActivity events={events} title="Recent Activity" />
          </div>
        )}
    </PortalShell>
  )
}
