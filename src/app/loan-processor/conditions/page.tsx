import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'

function statusBadge(status: string | null) {
  switch (status) {
    case 'Outstanding': return 'bg-red-100 text-red-700'
    case 'Received':    return 'bg-yellow-100 text-yellow-700'
    case 'Cleared':     return 'bg-green-100 text-green-700'
    case 'Waived':      return 'bg-gray-100 text-gray-500'
    default:            return 'bg-gray-100 text-gray-600'
  }
}

export default async function LoanProcessorConditionsPage() {
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

  // Get all loans assigned to this LP
  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address')
    .eq('loan_processor_id', lp.id)
    .order('created_at', { ascending: false })

  const loanIds = (loans ?? []).map(l => l.id)
  const loanMap: Record<string, string> = {}
  for (const l of loans ?? []) loanMap[l.id] = l.property_address ?? 'Unknown Address'

  // Get all conditions assigned to loan_processor across these loans
  const { data: conditions } = loanIds.length > 0
    ? await adminClient
        .from('conditions')
        .select('*')
        .in('loan_id', loanIds)
        .eq('assigned_to', 'loan_processor')
        .order('status', { ascending: true })
        .order('created_at', { ascending: true })
    : { data: [] }

  const outstanding = (conditions ?? []).filter(c => c.status !== 'Satisfied' && c.status !== 'Waived' && c.status !== 'Received')
  const received    = (conditions ?? []).filter(c => c.status === 'Received')
  const cleared     = (conditions ?? []).filter(c => c.status === 'Cleared' || c.status === 'Waived')

  return (
    <PortalShell userName={lp.full_name} userRole="Loan Processor" dashboardHref="/loan-processor" variant="loan-processor">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Conditions
        <span className="ml-2 text-base font-normal text-gray-400">{(conditions ?? []).length} total</span>
      </h2>

      {(!conditions || conditions.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500 text-sm">
            No conditions assigned to you yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {[
            { label: 'Outstanding', items: outstanding },
            { label: 'Received',    items: received },
            { label: 'Cleared / Waived', items: cleared },
          ].filter(g => g.items.length > 0).map(group => (
            <Card key={group.label}>
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                  {group.label} ({group.items.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-gray-100">
                  {group.items.map(condition => (
                    <div key={condition.id} className="py-3 flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{condition.title}</p>
                        {condition.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{condition.description}</p>
                        )}
                        <Link
                          href={`/loan-processor/loans/${condition.loan_id}`}
                          className="text-xs text-primary hover:opacity-80 mt-1 inline-block"
                        >
                          {loanMap[condition.loan_id] ?? 'View Loan'} →
                        </Link>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${statusBadge(condition.status)}`}>
                        {condition.status ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PortalShell>
  )
}
