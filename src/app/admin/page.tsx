import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { AdminLoansClient, type LoanWithMeta } from '@/components/admin-loans-client'
import { Building2, Users, AlertCircle } from 'lucide-react'

export default async function AdminPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users')
    .select('*')
    .eq('auth_user_id', user.id)
    .single()

  if (!admin) redirect('/dashboard')

  const adminClient = createAdminClient()

  const [
    { data: loans },
    { data: outstandingConditions },
    { count: borrowerCount },
    { data: archivedIds },
  ] = await Promise.all([
    adminClient
      .from('loans')
      .select('*, borrowers (full_name, email)')
      .order('created_at', { ascending: false })
      .limit(5000),  // PostgREST default is 1000; raise to fit FE's full book
    adminClient
      .from('conditions')
      .select('loan_id, status')
      .limit(10000),
    adminClient
      .from('borrowers')
      .select('*', { count: 'exact', head: true }),
    adminClient.rpc('get_archived_loan_ids'),
  ])

  // Per-loan counts:
  //   outstandingMap = items needing borrower/staff action (Outstanding + Rejected)
  //   pendingReviewMap = items submitted and waiting on UW (Received)
  //   totalConditionsMap = every condition on the loan
  const outstandingMap: Record<string, number> = {}
  const pendingReviewMap: Record<string, number> = {}
  const totalConditionsMap: Record<string, number> = {}
  for (const c of outstandingConditions ?? []) {
    totalConditionsMap[c.loan_id] = (totalConditionsMap[c.loan_id] ?? 0) + 1
    if (c.status === 'Outstanding' || c.status === 'Rejected') {
      outstandingMap[c.loan_id] = (outstandingMap[c.loan_id] ?? 0) + 1
    } else if (c.status === 'Received') {
      pendingReviewMap[c.loan_id] = (pendingReviewMap[c.loan_id] ?? 0) + 1
    }
  }

  // Build archived set via RPC (bypasses schema cache)
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  const loansWithMeta: LoanWithMeta[] = (loans ?? []).map(loan => ({
    ...loan,
    archived: archivedSet.has(loan.id),
    outstandingCount: outstandingMap[loan.id] ?? 0,
    pendingReviewCount: pendingReviewMap[loan.id] ?? 0,
    totalConditionsCount: totalConditionsMap[loan.id] ?? 0,
  }))

  const totalOutstanding =
    Object.values(outstandingMap).reduce((a, b) => a + b, 0)
    + Object.values(pendingReviewMap).reduce((a, b) => a + b, 0)

  return (
    <PortalShell
      userName={null}
      userRole="Administrator"
      dashboardHref="/admin"
      variant="admin"
      maxWidth="max-w-7xl"
    >
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Overview</h2>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-gray-900">{(loans ?? []).filter(l => !archivedSet.has(l.id)).length}</p>
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
                  <p className="text-3xl font-bold text-gray-900">{borrowerCount ?? 0}</p>
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
                  <p className="text-3xl font-bold text-red-600">{totalOutstanding}</p>
                  <p className="text-sm text-gray-500 mt-0.5">Outstanding Conditions</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Loans — search, filter, list/kanban toggle */}
        {loansWithMeta.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              No loans yet. Click &ldquo;Sync Pipedrive&rdquo; to import your deals.
            </CardContent>
          </Card>
        ) : (
          <AdminLoansClient loans={loansWithMeta} />
        )}
    </PortalShell>
  )
}
