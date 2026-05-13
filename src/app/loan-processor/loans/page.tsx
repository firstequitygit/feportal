import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { LoanListSorted } from '@/components/loan-list-sorted'
import { AvailableLoans } from '@/components/available-loans'
import { Building2, Users, AlertCircle } from 'lucide-react'
import { type Loan, type OutstandingCounts } from '@/lib/types'

export default async function LoanProcessorLoansPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const { data: lp } = await adminClient
    .from('loan_processors')
    .select('*')
    .eq('auth_user_id', user.id)
    .single()

  if (!lp) redirect('/login')

  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  const [{ data: loans }, { data: unassignedLoans }] = await Promise.all([
    adminClient
      .from('loans')
      .select('*, borrowers(full_name, email)')
      .eq('loan_processor_id', lp.id)
      .order('created_at', { ascending: false }),
    adminClient
      .from('loans')
      .select('*, borrowers(full_name, email), loan_officers(full_name)')
      .is('loan_processor_id', null)
      .neq('pipeline_stage', 'Closed')
      .order('created_at', { ascending: false }),
  ])

  const loanIds = (loans ?? []).map((l: Loan) => l.id)

  const [outstandingRes, eventsRes] = await Promise.all([
    loanIds.length > 0
      ? adminClient.from('conditions').select('loan_id, assigned_to').in('loan_id', loanIds).or('status.eq.Outstanding,status.eq.Rejected,status.eq.Received')
      : Promise.resolve({ data: [] }),
    loanIds.length > 0
      ? adminClient.from('loan_events').select('loan_id, created_at').in('loan_id', loanIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  const outstandingMap: Record<string, OutstandingCounts> = {}
  for (const c of outstandingRes.data ?? []) {
    const counts = outstandingMap[c.loan_id] ?? { you: 0, borrower: 0, team: 0, total: 0 }
    if (c.assigned_to === 'loan_processor')    counts.you++
    else if (c.assigned_to === 'borrower')     counts.borrower++
    else                                        counts.team++
    counts.total++
    outstandingMap[c.loan_id] = counts
  }

  const lastUpdatedMap: Record<string, string> = {}
  for (const e of eventsRes.data ?? []) {
    if (!lastUpdatedMap[e.loan_id]) lastUpdatedMap[e.loan_id] = e.created_at
  }

  const activeLoans = (loans ?? []).filter((l: Loan) => l.pipeline_stage !== 'Closed' && !archivedSet.has(l.id))
  const closedLoans = (loans ?? []).filter((l: Loan) => l.pipeline_stage === 'Closed' && !archivedSet.has(l.id))

  const totalLoans = activeLoans.length + closedLoans.length
  const uniqueBorrowers = new Set((loans ?? []).filter(l => !archivedSet.has(l.id) && l.borrower_id).map(l => l.borrower_id)).size
  const youOutstanding = Object.values(outstandingMap).reduce((s, c) => s + c.you, 0)
  const totalOutstanding = Object.values(outstandingMap).reduce((s, c) => s + c.total, 0)

  return (
    <PortalShell userName={lp.full_name} userRole="Loan Processor" dashboardHref="/loan-processor/inbox" variant="loan-processor">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Loans</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-900">{totalLoans}</p>
                <p className="text-sm text-gray-500 mt-0.5">Total Loans</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <Users className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-900">{uniqueBorrowers}</p>
                <p className="text-sm text-gray-500 mt-0.5">Borrowers</p>
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
                <p className="text-3xl font-bold text-red-600">{youOutstanding}</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Outstanding for you
                  {totalOutstanding > youOutstanding && (
                    <span className="text-gray-400"> · {totalOutstanding} total</span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <AvailableLoans
        loans={(unassignedLoans ?? []).filter(l => !archivedSet.has(l.id))}
        claimEndpoint="/api/loan-processor/claim"
        role="loan_processor"
      />
      <LoanListSorted
        activeLoans={activeLoans}
        closedLoans={closedLoans}
        outstandingMap={outstandingMap}
        lastUpdatedMap={lastUpdatedMap}
        linkPrefix="/loan-processor"
      />
    </PortalShell>
  )
}
