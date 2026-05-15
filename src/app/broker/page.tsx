import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, ChevronRight } from 'lucide-react'
import { PortalShell } from '@/components/portal-shell'
import { type PipelineStage } from '@/lib/types'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function stageBadgeColor(stage: PipelineStage | string | null): string {
  switch (stage) {
    case 'New Application':  return 'bg-gray-100 text-gray-700'
    case 'Processing':       return 'bg-blue-100 text-blue-700'
    case 'Pre-Underwriting': return 'bg-yellow-100 text-yellow-700'
    case 'Underwriting':     return 'bg-orange-100 text-orange-700'
    case 'Submitted':        return 'bg-green-100 text-green-700'
    case 'Closed':           return 'bg-purple-100 text-purple-700'
    default:                 return 'bg-gray-100 text-gray-600'
  }
}

export default async function BrokerDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: broker } = await adminClient
    .from('brokers').select('*').eq('auth_user_id', user.id).maybeSingle()
  if (!broker) redirect('/login')

  // Get archived loan IDs to exclude
  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address, pipeline_stage, loan_amount, loan_type, estimated_closing_date, borrowers(full_name)')
    .eq('broker_id', broker.id)
    .order('created_at', { ascending: false })

  const active = (loans ?? []).filter(l => !archivedSet.has(l.id) && l.pipeline_stage !== 'Closed')
  const closed = (loans ?? []).filter(l => !archivedSet.has(l.id) && l.pipeline_stage === 'Closed')

  return (
    <PortalShell
      userName={broker.full_name ?? broker.email}
      userRole="Broker"
      dashboardHref="/broker"
      variant="broker"
    >
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">My Loans</h2>
        <p className="text-sm text-gray-500 mt-1">
          {active.length} active loan{active.length === 1 ? '' : 's'}{closed.length > 0 ? ` · ${closed.length} closed` : ''}
        </p>
      </div>

      {(loans?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-600 font-medium">No loans assigned yet</p>
            <p className="text-xs text-gray-500 mt-1">Your loan officer will assign your loans to your portal shortly.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {active.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Active</CardTitle></CardHeader>
              <CardContent className="divide-y divide-gray-100">
                {active.map(l => {
                  const borrowerName = (l.borrowers as unknown as { full_name: string | null } | null)?.full_name
                  return (
                    <Link key={l.id} href={`/broker/loans/${l.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-gray-50 -mx-6 px-6 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{l.property_address ?? 'No property address'}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {borrowerName ?? 'Borrower TBD'}
                          {l.loan_type ? ` · ${l.loan_type}` : ''}
                          {l.loan_amount != null ? ` · ${formatCurrency(l.loan_amount)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stageBadgeColor(l.pipeline_stage)}`}>{l.pipeline_stage ?? '—'}</span>
                        <ChevronRight className="w-4 h-4 text-gray-300" />
                      </div>
                    </Link>
                  )
                })}
              </CardContent>
            </Card>
          )}
          {closed.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Closed</CardTitle></CardHeader>
              <CardContent className="divide-y divide-gray-100">
                {closed.map(l => {
                  const borrowerName = (l.borrowers as unknown as { full_name: string | null } | null)?.full_name
                  return (
                    <Link key={l.id} href={`/broker/loans/${l.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-gray-50 -mx-6 px-6 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{l.property_address ?? '—'}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {borrowerName ?? 'Borrower TBD'}
                          {l.loan_amount != null ? ` · ${formatCurrency(l.loan_amount)}` : ''}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    </Link>
                  )
                })}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PortalShell>
  )
}
