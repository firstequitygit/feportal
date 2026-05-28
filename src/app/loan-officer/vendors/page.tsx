import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { LoVendorsGrid, type VendorRow } from './lo-vendors-grid'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

interface DetailRow {
  loan_id: string
  title_company: string | null;  title_email: string | null;  title_phone: string | null
  insurance_company: string | null;  insurance_email: string | null;  insurance_phone: string | null
  appraisal_company: string | null;  appraisal_email: string | null;  appraisal_phone: string | null
}

/** Lowercased, trimmed name used as the grouping key. */
function vendorKey(s: string | null): string | null {
  if (!s) return null
  const k = s.trim().toLowerCase()
  return k || null
}

export default async function LoanOfficerVendorsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const lo = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
    adminClient, 'loan_officer', user.id
  )
  if (!lo) redirect('/login')

  // LO's active loans
  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address')
    .eq('loan_officer_id', lo.id)
    .eq('archived', false)
  const loansById = new Map((loans ?? []).map(l => [l.id, l]))
  const loanIds = [...loansById.keys()]

  // Pull loan_details for those loans
  const { data: details } = loanIds.length > 0
    ? await adminClient
        .from('loan_details')
        .select('loan_id, title_company, title_email, title_phone, insurance_company, insurance_email, insurance_phone, appraisal_company, appraisal_email, appraisal_phone')
        .in('loan_id', loanIds)
    : { data: [] }

  type VendorBucket = {
    name: string
    type: 'title' | 'insurance' | 'appraisal'
    emails: Set<string>
    phones: Set<string>
    loanIds: Set<string>
  }
  const buckets = new Map<string, VendorBucket>()

  function ingest(kind: 'title' | 'insurance' | 'appraisal', rows: DetailRow[]) {
    for (const r of rows) {
      const name  = kind === 'title' ? r.title_company  : kind === 'insurance' ? r.insurance_company  : r.appraisal_company
      const email = kind === 'title' ? r.title_email    : kind === 'insurance' ? r.insurance_email    : r.appraisal_email
      const phone = kind === 'title' ? r.title_phone    : kind === 'insurance' ? r.insurance_phone    : r.appraisal_phone
      const key = vendorKey(name)
      if (!key) continue
      const bucketKey = `${kind}::${key}`
      let bucket = buckets.get(bucketKey)
      if (!bucket) {
        bucket = { name: name!.trim(), type: kind, emails: new Set(), phones: new Set(), loanIds: new Set() }
        buckets.set(bucketKey, bucket)
      }
      if (email?.trim()) bucket.emails.add(email.trim())
      if (phone?.trim()) bucket.phones.add(phone.trim())
      bucket.loanIds.add(r.loan_id)
    }
  }

  const detailRows = (details ?? []) as DetailRow[]
  ingest('title', detailRows)
  ingest('insurance', detailRows)
  ingest('appraisal', detailRows)

  const rows: VendorRow[] = [...buckets.values()].map((b, i) => ({
    id: `${b.type}-${i}`,
    name: b.name,
    type: b.type,
    emails: [...b.emails],
    phones: [...b.phones],
    loan_count: b.loanIds.size,
    loan_ids: [...b.loanIds],
    loan_addresses: [...b.loanIds].map(id => loansById.get(id)?.property_address ?? '(no address)'),
  }))

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'loan_officer'

  return (
    <PortalShell
      userName={lo.full_name}
      userRole="Loan Officer"
      dashboardHref="/loan-officer/inbox"
      variant="loan-officer"
      maxWidth="max-w-screen-2xl"
      impersonation={isImpersonating ? {
        kind: 'loan_officer',
        name: lo.full_name,
        exitHref: impersonationExitHref(),
      } : null}
    >
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Vendors</h2>
      <p className="text-sm text-gray-500 mb-6">
        Title companies, insurance companies, and appraisers attached to your loans
        (derived from the Loan Details section on each file). Filter by type or sort by loan
        count to triage. Click a loan address to open the file and update vendor info there.
      </p>
      <LoVendorsGrid initialRows={rows} />
    </PortalShell>
  )
}
