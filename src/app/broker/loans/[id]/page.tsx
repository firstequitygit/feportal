import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type Condition, type Document } from '@/lib/types'
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

export default async function BrokerLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: broker } = await adminClient
    .from('brokers').select('*').eq('auth_user_id', user.id).maybeSingle()
  if (!broker) redirect('/login')

  // Loan must belong to this broker
  const { data: loan } = await adminClient
    .from('loans')
    .select('*, borrowers(full_name, email, phone, current_address_street, current_address_city, current_address_state, current_address_zip)')
    .eq('id', id)
    .eq('broker_id', broker.id)
    .single()
  if (!loan) notFound()

  // Staff contacts (full visibility for broker, same as borrower view)
  const lpIds = [loan.loan_processor_id, loan.loan_processor_id_2].filter((x: string | null): x is string => !!x)
  const [loanOfficer, lpRows] = await Promise.all([
    loan.loan_officer_id
      ? adminClient.from('loan_officers').select('full_name, email, phone, title').eq('id', loan.loan_officer_id).single().then(({ data }) => data)
      : null,
    lpIds.length > 0
      ? adminClient.from('loan_processors').select('id, full_name, email, phone, title').in('id', lpIds).then(({ data }) => data)
      : null,
  ])
  const loanProcessors = lpIds
    .map(lpId => (lpRows ?? []).find(r => r.id === lpId))
    .filter((r): r is { id: string; full_name: string; email: string | null; phone: string | null; title: string | null } => !!r)

  const [{ data: conditions }, { data: documents }, { data: events }] = await Promise.all([
    adminClient.from('conditions').select('*').eq('loan_id', loan.id).order('created_at', { ascending: true }),
    adminClient.from('documents').select('*').eq('loan_id', loan.id).order('created_at', { ascending: false }),
    adminClient.from('loan_events').select('*').eq('loan_id', loan.id).order('created_at', { ascending: false }),
  ])

  const signedUrlMap: Record<string, string> = {}
  await Promise.all(
    (documents ?? []).map(async doc => {
      const { data } = await adminClient.storage.from('documents').createSignedUrl(doc.file_path, 3600)
      if (data?.signedUrl) signedUrlMap[doc.id] = data.signedUrl
    })
  )

  const borrower = loan.borrowers as unknown as {
    full_name: string | null
    email: string | null
    phone: string | null
    current_address_street: string | null
    current_address_city: string | null
    current_address_state: string | null
    current_address_zip: string | null
  } | null

  return (
    <PortalShell
      userName={broker.full_name ?? broker.email}
      userRole="Broker"
      dashboardHref="/broker"
      variant="broker"
    >
      <LoanRealtimeRefresh loanId={loan.id} />
      <Link href="/broker" className="text-sm text-primary hover:opacity-80 mb-4 inline-block">
        ← Back to My Loans
      </Link>

      <h2 className="text-2xl font-bold text-gray-900 mt-2 mb-6">
        {loan.property_address ?? 'Loan Details'}
      </h2>

      <LoanProgressTracker
        stage={loan.pipeline_stage}
        fundedMessage="This loan has been funded."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Loan Details */}
        <Card>
          <CardHeader><CardTitle className="text-base">Loan Details</CardTitle></CardHeader>
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

        {/* Right column */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Property Details</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Property Address',    value: loan.property_address ?? '—' },
                { label: 'Borrowing Entity',    value: loan.entity_name ?? '—' },
                { label: 'ARV',                 value: formatCurrency(loan.arv) },
                { label: 'Construction Budget', value: formatCurrency(loan.rehab_budget) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-gray-900">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Borrower info — broker has full visibility */}
          {borrower && (
            <Card>
              <CardHeader><CardTitle className="text-base">Borrower</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium text-gray-900">{borrower.full_name ?? '—'}</p>
                {borrower.email && (
                  <p className="text-gray-500">
                    ✉ <a href={`mailto:${borrower.email}`} className="text-primary hover:opacity-80">{borrower.email}</a>
                  </p>
                )}
                {borrower.phone && (
                  <p className="text-gray-500">
                    📞 <a href={`tel:${borrower.phone}`} className="text-primary hover:opacity-80">{borrower.phone}</a>
                  </p>
                )}
                {(borrower.current_address_street || borrower.current_address_city) && (
                  <p className="text-gray-500 pt-1">
                    {[
                      borrower.current_address_street,
                      [borrower.current_address_city, borrower.current_address_state, borrower.current_address_zip].filter(Boolean).join(', '),
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {loanOfficer && (
            <Card>
              <CardHeader><CardTitle className="text-base">Loan Officer</CardTitle></CardHeader>
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

          {loanProcessors.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">{loanProcessors.length > 1 ? 'Loan Processors' : 'Loan Processor'}</CardTitle></CardHeader>
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

      {/* Conditions — reuses the borrower-facing component, which calls
          /api/loans/upload + /api/loans/conditions/response. Both now accept
          either the borrower or the broker on the loan. */}
      <ConditionsList
        loanId={loan.id}
        propertyAddress={loan.property_address ?? null}
        conditions={(conditions ?? []) as Condition[]}
        documents={(documents ?? []) as Document[]}
        signedUrlMap={signedUrlMap}
      />

      {(events?.length ?? 0) > 0 && (
        <div className="mt-6">
          <LoanActivity events={events!} title="Recent Activity" />
        </div>
      )}
    </PortalShell>
  )
}
