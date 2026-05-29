import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

function statusBadge(status: string | null) {
  switch (status) {
    case 'Outstanding': return 'bg-red-100 text-red-700'
    case 'Received':    return 'bg-yellow-100 text-yellow-700'
    case 'Satisfied':   return 'bg-green-100 text-green-700'
    case 'Waived':      return 'bg-gray-100 text-gray-500'
    case 'Rejected':    return 'bg-red-100 text-red-800'
    default:            return 'bg-gray-100 text-gray-600'
  }
}

export default async function LoanProcessorConditionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const lp = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null; is_ops_manager: boolean | null }>(
    adminClient, 'loan_processor', user.id
  )
  if (!lp) redirect('/login')

  // Fetch every LP-assigned condition. For ops managers we skip the loan
  // enumeration entirely — listing all 100+ loan ids in a single .in() blew
  // past PostgREST's URL length limit on the prod dataset and returned an
  // empty result. Regular LPs still scope by their assigned loans.
  type ConditionRow = {
    id: string
    loan_id: string
    title: string
    description: string | null
    status: string
    assigned_to: string
    category: string | null
    rejection_reason: string | null
    response: string | null
    created_at: string
    updated_at: string
  }
  // Active-loan-id allowlist used to filter conditions to live deals only.
  // Archived/cancelled loans still keep their conditions in the DB; we just
  // don't want them cluttering the LP's open work list. Same filter the
  // dashboard already applies (.eq('archived', false)).
  const activeLoanIds = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await adminClient
      .from('loans')
      .select('id')
      .eq('archived', false)
      .range(from, from + 999)
    if (error || !data) break
    for (const l of data) activeLoanIds.add(l.id)
    if (data.length < 1000) break
  }

  const conditions: ConditionRow[] = []
  if (lp.is_ops_manager) {
    // Page through every LP-assigned condition in the portal, then trim to
    // active loans client-side. Skips the .in('loan_id', […100s of uuids…])
    // approach that previously blew the URL length cap.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await adminClient
        .from('conditions')
        .select('*')
        .eq('assigned_to', 'loan_processor')
        .order('status', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, from + 999)
      if (error || !data) break
      conditions.push(...(data as ConditionRow[]))
      if (data.length < 1000) break
    }
  } else {
    // Scope to active, non-Closed loans. Without these filters, LPs with
    // long histories (Rebecca has 100+ active + hundreds of closed/archived)
    // blow past PostgREST's 1000-row cap. The cap drops her recent loans
    // (no ORDER BY = arbitrary slice) so conditions on real work disappear.
    // Same fix the LO Conditions page got. Mirrors the Inbox query.
    const { data: loans } = await adminClient
      .from('loans')
      .select('id')
      .or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`)
      .eq('archived', false)
      .neq('pipeline_stage', 'Closed')
    const loanIds = (loans ?? []).map(l => l.id)
    if (loanIds.length > 0) {
      const { data } = await adminClient
        .from('conditions')
        .select('*')
        .in('loan_id', loanIds)
        .eq('assigned_to', 'loan_processor')
        .order('status', { ascending: true })
        .order('created_at', { ascending: true })
      if (data) conditions.push(...(data as ConditionRow[]))
    }
  }

  // Drop conditions whose loan is archived/cancelled — those are dead files.
  const activeConditions = conditions.filter(c => activeLoanIds.has(c.loan_id))
  // Re-bind to the variable name the rest of the page reads so the existing
  // bucket / render logic doesn't have to change.
  conditions.length = 0
  conditions.push(...activeConditions)

  // Property addresses for the loans referenced by these conditions only —
  // avoids the 1000-row cap on a "fetch every loan in the portal" query.
  const referencedLoanIds = [...new Set(conditions.map(c => c.loan_id))]
  const loanMap: Record<string, string> = {}
  if (referencedLoanIds.length > 0) {
    // Chunk to keep .in() URLs comfortably below the PostgREST cap.
    for (let i = 0; i < referencedLoanIds.length; i += 200) {
      const slice = referencedLoanIds.slice(i, i + 200)
      const { data } = await adminClient
        .from('loans').select('id, property_address').in('id', slice)
      for (const l of data ?? []) loanMap[l.id] = l.property_address ?? 'Unknown Address'
    }
  }

  // Three buckets: open work, awaiting review, completed. Rejected lives in
  // outstanding because it still needs the borrower/team to act.
  const outstanding = (conditions ?? []).filter(c => c.status === 'Outstanding' || c.status === 'Rejected')
  const received    = (conditions ?? []).filter(c => c.status === 'Received')
  const cleared     = (conditions ?? []).filter(c => c.status === 'Satisfied' || c.status === 'Waived')

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'loan_processor'

  return (
    <PortalShell userName={lp.full_name} userRole="Loan Processor" dashboardHref="/loan-processor" variant="loan-processor" impersonation={isImpersonating ? {
        kind: 'loan_processor',
        name: lp.full_name,
        exitHref: impersonationExitHref(),
      } : null}>
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
            { label: 'Satisfied / Waived', items: cleared },
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
