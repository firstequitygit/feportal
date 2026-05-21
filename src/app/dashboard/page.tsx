import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Building2, FileCheck, AlertCircle, ChevronRight } from 'lucide-react'
import { type Loan, type PipelineStage, PIPELINE_STAGES } from '@/lib/types'
import { PortalShell } from '@/components/portal-shell'
import { formatDate } from '@/lib/format-date'
import { formatInterestRate } from '@/lib/format-interest-rate'
import { resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'
import { ImpersonationBanner } from '@/components/impersonation-banner'

function formatStage(stage: PipelineStage | string | null): string {
  if (!stage) return 'Unknown'
  return stage.split(' /')[0].trim()
}

function stageBadgeColor(stage: PipelineStage | null): string {
  switch (stage) {
    case 'New Application':  return 'bg-gray-100 text-gray-700'
    case 'Processing':       return 'bg-blue-100 text-blue-700'
    case 'Pre-Underwriting': return 'bg-yellow-100 text-yellow-700'
    case 'Underwriting':     return 'bg-orange-100 text-orange-700'
    case 'Conditionally Approved': return 'bg-teal-100 text-teal-700'
    case 'Approved':         return 'bg-green-100 text-green-700'
    case 'Closed':           return 'bg-purple-100 text-purple-700'
    default:                        return 'bg-gray-100 text-gray-600'
  }
}

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  // Admin "View as borrower" support — if set, skip all the role redirects
  // and load this dashboard as if the admin were the impersonated borrower.
  const sp = await searchParams
  const impersonation = await resolveImpersonation(adminClient, user.id, sp)
  const isImpersonating = impersonation?.kind === 'borrower'

  // If admin (and NOT impersonating), send to admin panel
  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()

  if (admin && !isImpersonating) redirect('/admin')

  // If loan officer, send to loan officer portal
  const { data: loanOfficer } = await adminClient
    .from('loan_officers')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()

  if (loanOfficer && !isImpersonating) redirect('/loan-officer')

  // If loan processor, send to loan processor portal
  const { data: loanProcessor } = await adminClient
    .from('loan_processors')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()

  if (loanProcessor && !isImpersonating) redirect('/loan-processor')

  // If underwriter, send to underwriter portal
  const { data: underwriter } = await adminClient
    .from('underwriters')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()

  if (underwriter && !isImpersonating) redirect('/underwriter')

  // If broker, send to broker portal. Self-heal the auth_user_id link by email
  // if it wasn't set (defensive — the invite flow always sets it now).
  let { data: broker } = await adminClient
    .from('brokers').select('id').eq('auth_user_id', user.id).maybeSingle()
  if (!broker && user.email) {
    const { data: byEmail } = await adminClient
      .from('brokers').select('id').eq('email', user.email).maybeSingle()
    if (byEmail) {
      await adminClient.from('brokers').update({ auth_user_id: user.id }).eq('id', byEmail.id)
      broker = byEmail
    }
  }
  if (broker && !isImpersonating) redirect('/broker')

  // Get borrower record. Use the admin client to avoid any RLS surprises;
  // this code already verified the user above so privilege escalation isn't
  // a concern. We also self-heal if the borrower row exists by email but
  // wasn't linked to the auth user — common when the borrower was created
  // first by the JotForm intake (with auth_user_id NULL) and the invite
  // flow left the link unset.
  let { data: borrower } = isImpersonating
    ? await adminClient.from('borrowers').select('*').eq('id', impersonation.id).maybeSingle()
    : await adminClient.from('borrowers').select('*').eq('auth_user_id', user.id).maybeSingle()

  if (!borrower && !isImpersonating && user.email) {
    const { data: byEmail } = await adminClient
      .from('borrowers')
      .select('*')
      .eq('email', user.email)
      .maybeSingle()
    if (byEmail) {
      await adminClient
        .from('borrowers')
        .update({ auth_user_id: user.id })
        .eq('id', byEmail.id)
      borrower = { ...byEmail, auth_user_id: user.id }
    }
  }

  if (!borrower) redirect('/login')

  // Match the borrower in any of the four slots so co-borrowers see the
  // loan in their dashboard too.
  const { data: loans } = await adminClient
    .from('loans')
    .select('*')
    .or(`borrower_id.eq.${borrower.id},borrower_id_2.eq.${borrower.id},borrower_id_3.eq.${borrower.id},borrower_id_4.eq.${borrower.id}`)
    .order('created_at', { ascending: false })

  const activeLoans = (loans ?? []).filter((l: Loan) => l.pipeline_stage !== 'Closed')
  const closedLoans = (loans ?? []).filter((l: Loan) => l.pipeline_stage === 'Closed')

  const loanIds = (loans ?? []).map(l => l.id)
  // Anything not yet Satisfied or Waived counts as outstanding from the
  // borrower's POV — including Received items that are awaiting UW review.
  const { data: outstandingConditions } = loanIds.length > 0
    ? await adminClient.from('conditions').select('loan_id').in('loan_id', loanIds).or('status.eq.Outstanding,status.eq.Rejected,status.eq.Received')
    : { data: [] }

  const totalOutstanding = (outstandingConditions ?? []).length

  // Pull loan_type_one (from JotForm intake) keyed by loan id so we can
  // surface the loan-purpose label on the borrower's dashboard card.
  const { data: loanDetailsRows } = loanIds.length > 0
    ? await adminClient.from('loan_details').select('loan_id, loan_type_one').in('loan_id', loanIds)
    : { data: [] }
  const loanTypeOneByLoanId: Record<string, string | null> = {}
  for (const row of loanDetailsRows ?? []) {
    loanTypeOneByLoanId[row.loan_id] = row.loan_type_one ?? null
  }

  return (
    <PortalShell userName={borrower.full_name ?? user.email ?? null} userRole="Borrower" dashboardHref="/dashboard">
        {isImpersonating && (
          <ImpersonationBanner kind="borrower" name={borrower.full_name} exitHref={impersonationExitHref()} />
        )}
        <h2 className="text-2xl font-bold text-gray-900 mb-6">My Loans</h2>

        {/* Stats */}
        {(loans ?? []).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardContent className="pt-6 pb-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-gray-900">{activeLoans.length}</p>
                    <p className="text-sm text-gray-500 mt-0.5">Active Loans</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 pb-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <FileCheck className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-gray-900">{(loans ?? []).length}</p>
                    <p className="text-sm text-gray-500 mt-0.5">Total Loans</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 pb-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-6 h-6 text-red-500" />
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-red-600">{totalOutstanding}</p>
                    <p className="text-sm text-gray-500 mt-0.5">Outstanding Conditions</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Active Loans */}
        {activeLoans.length > 0 && (
          <section className="mb-10">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Active ({activeLoans.length})
            </h3>
            <div className="space-y-3">
              {activeLoans.map((loan: Loan) => (
                <Link key={loan.id} href={`/loans/${loan.id}`} className="block group">
                  <Card className="hover:shadow-md hover:border-primary/40 transition-all cursor-pointer border border-gray-200">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate">
                            {loan.property_address ?? 'Address not set'}
                          </p>
                          <p className="text-sm text-gray-500 mt-0.5">
                            {loan.loan_type ?? '—'} &bull; {formatCurrency(loan.loan_amount)}
                          </p>
                        </div>
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${stageBadgeColor(loan.pipeline_stage)}`}>
                          {formatStage(loan.pipeline_stage)}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-3 text-sm">
                        <div>
                          <p className="text-gray-500 text-xs">Interest Rate</p>
                          <p className="font-medium">{formatInterestRate(loan.interest_rate)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Rate Locked / Days</p>
                          <p className="font-medium">{loan.rate_locked_days ?? '—'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Loan Type I</p>
                          <p className="font-medium">{loanTypeOneByLoanId[loan.id] ?? '—'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Term</p>
                          <p className="font-medium">{loan.term_months ? `${loan.term_months} mo` : '—'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Est. Closing Date</p>
                          <p className="font-medium">{formatDate(loan.estimated_closing_date)}</p>
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-end gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                        <span>View loan details</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Closed Loans */}
        {closedLoans.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Closed ({closedLoans.length})
            </h3>
            <div className="space-y-3">
              {closedLoans.map((loan: Loan) => (
                <Link key={loan.id} href={`/loans/${loan.id}`} className="block group">
                  <Card className="hover:shadow-md hover:border-primary/40 hover:opacity-100 transition-all cursor-pointer border border-gray-200 opacity-75">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate">
                            {loan.property_address ?? 'Address not set'}
                          </p>
                          <p className="text-sm text-gray-500 mt-0.5">
                            {loan.loan_type ?? '—'} &bull; {formatCurrency(loan.loan_amount)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${stageBadgeColor(loan.pipeline_stage)}`}>
                            Closed
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {(!loans || loans.length === 0) && (
          <Card className="text-center py-16">
            <CardContent>
              <p className="text-gray-500">No loans found on your account.</p>
              <p className="text-sm text-gray-400 mt-1">
                Contact your loan officer if you believe this is an error.
              </p>
            </CardContent>
          </Card>
        )}
    </PortalShell>
  )
}
