import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { AdminArchiveButton } from '@/components/admin-archive-button'
import { AdminDeleteLoanButton } from '@/components/admin-delete-loan-button'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

export default async function ArchivedLoansPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('*').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const adminClient = createAdminClient()

  // Fetch archived loans directly via the column, paginated. (Previously
  // fetched IDs via get_archived_loan_ids then used .in('id', ids) — that URL
  // gets too long with 1000+ UUIDs and PostgREST returns 400. .limit(5000)
  // doesn't help either because PostgREST's server-side max-rows cap is 1000.)
  type ArchivedLoan = {
    id: string
    property_address: string | null
    loan_type: string | null
    loan_amount: number | null
    borrowers: { full_name: string | null; email: string | null } | null
  }
  const loans: ArchivedLoan[] = []
  let from = 0
  let totalArchived: number | null = null
  while (true) {
    const { data, count, error } = await adminClient
      .from('loans')
      .select('id, property_address, loan_type, loan_amount, borrowers(full_name, email)', { count: 'exact' })
      .eq('archived', true)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error || !data) break
    if (totalArchived === null) totalArchived = count
    loans.push(...(data as unknown as ArchivedLoan[]))
    if (data.length < 1000) break
    from += 1000
  }

  return (
    <PortalShell userName={null} userRole="Administrator" dashboardHref="/admin" variant="admin" maxWidth="max-w-7xl">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Archived Loans
          <span className="ml-2 text-base font-normal text-gray-400">{totalArchived ?? loans?.length ?? 0} loan{(totalArchived ?? loans?.length ?? 0) !== 1 ? 's' : ''}</span>
        </h2>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Archived Loans</CardTitle>
          </CardHeader>
          <CardContent>
            {(!loans || loans.length === 0) ? (
              <p className="text-sm text-gray-500 py-4">No archived loans.</p>
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
                    <div className="flex items-center gap-3 shrink-0">
                      <Link
                        href={`/admin/loans/${loan.id}`}
                        className="text-xs text-primary hover:opacity-80"
                      >
                        View →
                      </Link>
                      <AdminArchiveButton loanId={loan.id} archived={true} />
                      <AdminDeleteLoanButton loanId={loan.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
    </PortalShell>
  )
}
