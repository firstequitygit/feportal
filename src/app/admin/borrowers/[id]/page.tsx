import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function AdminBorrowerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient.from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const { data: borrower } = await adminClient
    .from('borrowers')
    .select('id, full_name, email, phone, created_at, auth_user_id')
    .eq('id', id)
    .single()
  if (!borrower) notFound()

  // Find loans this borrower is on (any of the 4 borrower slots)
  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address, pipeline_stage, updated_at')
    .or(`borrower_id.eq.${id},borrower_id_2.eq.${id},borrower_id_3.eq.${id},borrower_id_4.eq.${id}`)
    .order('updated_at', { ascending: false })

  return (
    <PortalShell
      userName={null}
      userRole="Administrator"
      dashboardHref="/admin"
      variant="admin"
      isSuperAdmin={admin.is_super ?? false}
      maxWidth="max-w-4xl"
    >
      <div className="mb-4">
        <Link href="/admin/borrowers" className="text-sm text-primary hover:underline">← All borrowers</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{borrower.full_name ?? borrower.email}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {borrower.auth_user_id ? 'Active portal account' : 'Invited (no portal login yet)'}
      </p>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Contact info</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500">Email</dt><dd>{borrower.email}</dd>
            <dt className="text-gray-500">Phone</dt><dd>{borrower.phone ?? '—'}</dd>
            <dt className="text-gray-500">Created</dt><dd>{borrower.created_at ? new Date(borrower.created_at).toLocaleString() : '—'}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Loans</CardTitle></CardHeader>
        <CardContent>
          {!loans?.length ? (
            <p className="text-sm text-gray-400">Not on any loans.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {loans.map(l => (
                <li key={l.id} className="py-2 flex items-center justify-between gap-3">
                  <Link href={`/admin/loans/${l.id}`} className="text-sm text-primary hover:underline truncate">
                    {l.property_address ?? '(no address)'}
                  </Link>
                  <span className="text-xs text-gray-500 shrink-0">{l.pipeline_stage ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
