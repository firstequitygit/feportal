import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

export default async function LoanProcessorArchivedPage() {
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
  const idList = (archivedIds ?? []).map((r: { loan_id: string }) => r.loan_id)

  const { data: loans } = idList.length > 0
    ? await adminClient
        .from('loans')
        .select('*, borrowers(full_name, email)')
        .in('id', idList)
        .eq('loan_processor_id', lp.id)
        .order('created_at', { ascending: false })
    : { data: [] }

  return (
    <PortalShell userName={lp.full_name} userRole="Loan Processor" dashboardHref="/loan-processor" variant="loan-processor">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Archived Loans
        <span className="ml-2 text-base font-normal text-gray-400">{(loans ?? []).length} loan{(loans ?? []).length !== 1 ? 's' : ''}</span>
      </h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Archived Loans</CardTitle>
        </CardHeader>
        <CardContent>
          {(!loans || loans.length === 0) ? (
            <p className="text-sm text-gray-500 py-4">No archived loans assigned to you.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {loans.map((loan) => (
                <div key={loan.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{loan.property_address ?? '—'}</p>
                    <p className="text-sm text-gray-500">
                      {loan.borrowers?.full_name ?? <span className="italic">Unassigned</span>}
                      {' · '}
                      {loan.loan_type ?? '—'}
                      {' · '}
                      {formatCurrency(loan.loan_amount)}
                    </p>
                  </div>
                  <Link
                    href={`/loan-processor/loans/${loan.id}`}
                    className="text-xs text-primary hover:opacity-80 shrink-0"
                  >
                    View →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
