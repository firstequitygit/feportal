import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { Building2, ShieldCheck } from 'lucide-react'

interface LoanRow {
  id: string
  property_address: string | null
}

interface DetailRow {
  loan_id: string
  title_company: string | null
  title_email: string | null
  title_phone: string | null
  insurance_company: string | null
  insurance_email: string | null
  insurance_phone: string | null
}

interface VendorAggregate {
  name: string             // canonical (most-common) display name
  emails: Set<string>      // every email seen for this vendor
  phones: Set<string>      // every phone seen
  loans: LoanRow[]         // loans this vendor is attached to
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
  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) redirect('/login')

  // LO's active loans
  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address')
    .eq('loan_officer_id', lo.id)
    .eq('archived', false)
  const loansById = new Map<string, LoanRow>((loans ?? []).map(l => [l.id, l]))
  const loanIds = [...loansById.keys()]

  // Pull loan_details for those loans
  const { data: details } = loanIds.length > 0
    ? await adminClient
        .from('loan_details')
        .select('loan_id, title_company, title_email, title_phone, insurance_company, insurance_email, insurance_phone')
        .in('loan_id', loanIds)
    : { data: [] }

  // Aggregate per vendor type
  function aggregate(rows: DetailRow[], kind: 'title' | 'insurance'): VendorAggregate[] {
    const buckets = new Map<string, VendorAggregate>()
    for (const r of rows) {
      const name = kind === 'title' ? r.title_company : r.insurance_company
      const email = kind === 'title' ? r.title_email : r.insurance_email
      const phone = kind === 'title' ? r.title_phone : r.insurance_phone
      const key = vendorKey(name)
      if (!key) continue
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { name: name!.trim(), emails: new Set(), phones: new Set(), loans: [] }
        buckets.set(key, bucket)
      }
      if (email?.trim()) bucket.emails.add(email.trim())
      if (phone?.trim()) bucket.phones.add(phone.trim())
      const loan = loansById.get(r.loan_id)
      if (loan && !bucket.loans.find(l => l.id === loan.id)) bucket.loans.push(loan)
    }
    return [...buckets.values()].sort((a, b) =>
      b.loans.length - a.loans.length || a.name.localeCompare(b.name)
    )
  }

  const titleVendors = aggregate((details ?? []) as DetailRow[], 'title')
  const insuranceVendors = aggregate((details ?? []) as DetailRow[], 'insurance')

  return (
    <PortalShell
      userName={lo.full_name}
      userRole="Loan Officer"
      dashboardHref="/loan-officer/inbox"
      variant="loan-officer"
      maxWidth="max-w-3xl"
    >
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Vendors</h2>
      <p className="text-sm text-gray-500 mb-6">
        Title companies and insurance companies attached to your loans (from the Loan Details
        section on each file). Click a loan to open it and update the vendor info there.
      </p>

      <div className="space-y-6">
        <VendorSection
          title="Title Companies"
          icon={Building2}
          vendors={titleVendors}
          emptyMessage="No title companies on your loans yet."
        />
        <VendorSection
          title="Insurance Companies"
          icon={ShieldCheck}
          vendors={insuranceVendors}
          emptyMessage="No insurance companies on your loans yet."
        />
      </div>
    </PortalShell>
  )
}

function VendorSection({ title, icon: Icon, vendors, emptyMessage }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  vendors: VendorAggregate[]
  emptyMessage: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          {title}
          <span className="text-sm font-normal text-gray-400">{vendors.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {vendors.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">{emptyMessage}</p>
        ) : (
          <div className="space-y-4 divide-y divide-gray-100">
            {vendors.map(v => (
              <div key={v.name} className="pt-4 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{v.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {[...v.emails].join(', ') || '—'}
                      {v.phones.size > 0 ? ` · ${[...v.phones].join(', ')}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                    On {v.loans.length} loan{v.loans.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="mt-2 space-y-0.5">
                  {v.loans.map(l => (
                    <li key={l.id}>
                      <Link
                        href={`/loan-officer/loans/${l.id}`}
                        className="text-xs text-primary hover:underline truncate block"
                      >
                        {l.property_address ?? '(no address)'}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
