import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { Building2, ShieldCheck, FileSearch } from 'lucide-react'

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
  appraisal_company: string | null
  appraisal_email: string | null
  appraisal_phone: string | null
}

interface VendorAggregate {
  name: string
  emails: Set<string>
  phones: Set<string>
  loans: LoanRow[]
}

function vendorKey(s: string | null): string | null {
  if (!s) return null
  const k = s.trim().toLowerCase()
  return k || null
}

export default async function LoanProcessorVendorsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: lp } = await adminClient
    .from('loan_processors').select('id, full_name, is_ops_manager').eq('auth_user_id', user.id).single()
  if (!lp) redirect('/login')

  // Ops managers see vendors across every active loan.
  const lpLoansQuery = adminClient
    .from('loans')
    .select('id, property_address')
    .eq('archived', false)
  const { data: loans } = await (lp.is_ops_manager
    ? lpLoansQuery
    : lpLoansQuery.or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`))
  const loansById = new Map<string, LoanRow>((loans ?? []).map(l => [l.id, l]))
  const loanIds = [...loansById.keys()]

  const { data: details } = loanIds.length > 0
    ? await adminClient
        .from('loan_details')
        .select('loan_id, title_company, title_email, title_phone, insurance_company, insurance_email, insurance_phone, appraisal_company, appraisal_email, appraisal_phone')
        .in('loan_id', loanIds)
    : { data: [] }

  function aggregate(rows: DetailRow[], kind: 'title' | 'insurance' | 'appraisal'): VendorAggregate[] {
    const buckets = new Map<string, VendorAggregate>()
    for (const r of rows) {
      const name  = kind === 'title' ? r.title_company  : kind === 'insurance' ? r.insurance_company  : r.appraisal_company
      const email = kind === 'title' ? r.title_email    : kind === 'insurance' ? r.insurance_email    : r.appraisal_email
      const phone = kind === 'title' ? r.title_phone    : kind === 'insurance' ? r.insurance_phone    : r.appraisal_phone
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
  const appraiserVendors = aggregate((details ?? []) as DetailRow[], 'appraisal')

  return (
    <PortalShell
      userName={lp.full_name}
      userRole="Loan Processor"
      dashboardHref="/loan-processor/inbox"
      variant="loan-processor"
      maxWidth="max-w-3xl"
    >
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Vendors</h2>
      <p className="text-sm text-gray-500 mb-6">
        Title companies, insurance companies, and appraisers attached to your loans (from the
        Loan Details section on each file). Click a loan to open it and update the vendor info there.
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
        <VendorSection
          title="Appraisers"
          icon={FileSearch}
          vendors={appraiserVendors}
          emptyMessage="No appraisers on your loans yet."
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
                        href={`/loan-processor/loans/${l.id}`}
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
