// Staff E-Signature console — send fixed forms to a loan's borrower for
// signature via BoldSign. Shared route, gated to any staff role.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { EsignConsole, type EsignEnvelopeRow } from '@/components/esign-console'
import { isEsignEnabled } from '@/lib/esign/boldsign'
import { ESIGN_FORMS, ESIGN_DOC_LABELS } from '@/lib/esign/forms'
import { formatLoanName } from '@/lib/format-loan-name'

type StaffVariant = 'admin' | 'loan-officer' | 'loan-processor' | 'underwriter'
interface StaffCtx { name: string | null; variant: StaffVariant; dashboardHref: string }

async function getStaffCtx(authUserId: string): Promise<StaffCtx | null> {
  const adminClient = createAdminClient()
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_officers').select('full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_processors').select('full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('underwriters').select('full_name').eq('auth_user_id', authUserId).maybeSingle(),
  ])
  if (admin) return { name: admin.full_name, variant: 'admin', dashboardHref: '/admin' }
  if (lo) return { name: lo.full_name, variant: 'loan-officer', dashboardHref: '/loan-officer/inbox' }
  if (lp) return { name: lp.full_name, variant: 'loan-processor', dashboardHref: '/loan-processor/inbox' }
  if (uw) return { name: uw.full_name, variant: 'underwriter', dashboardHref: '/underwriter/inbox' }
  return null
}

export default async function ESignaturePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const staff = await getStaffCtx(user.id)
  if (!staff) redirect('/dashboard')

  const adminClient = createAdminClient()

  const [{ data: loans }, { data: envelopes }] = await Promise.all([
    adminClient
      .from('loans')
      .select('id, property_address, loan_number, entity_name, borrowers!borrower_id(full_name, email)')
      .eq('archived', false)
      .neq('pipeline_stage', 'Closed')
      .order('created_at', { ascending: false })
      .limit(1000),
    adminClient
      .from('esign_envelopes')
      .select('id, document_kind, status, signer_name, sent_at, loans!loan_id(property_address, loan_number, borrowers!borrower_id(full_name))')
      .order('sent_at', { ascending: false })
      .limit(40),
  ])

  const loanOptions = (loans ?? []).map(l => {
    const b = l.borrowers as unknown as { full_name: string | null; email: string | null } | null
    return {
      id: l.id as string,
      name: formatLoanName({ borrowerName: b?.full_name ?? null, propertyAddress: l.property_address, loanNumber: l.loan_number }),
      borrowerName: b?.full_name ?? null,
      borrowerEmail: b?.email ?? null,
      propertyAddress: (l.property_address as string | null) ?? null,
      loanNumber: (l.loan_number as string | null) ?? null,
      entityName: (l.entity_name as string | null) ?? null,
    }
  })

  const envelopeRows: EsignEnvelopeRow[] = (envelopes ?? []).map(e => {
    const loan = e.loans as unknown as { property_address: string | null; loan_number: string | null; borrowers: { full_name: string | null } | null } | null
    return {
      id: e.id as string,
      documentLabel: ESIGN_DOC_LABELS[e.document_kind as string] ?? (e.document_kind as string),
      loanName: loan
        ? formatLoanName({ borrowerName: loan.borrowers?.full_name ?? null, propertyAddress: loan.property_address, loanNumber: loan.loan_number })
        : '—',
      signerName: (e.signer_name as string | null) ?? null,
      status: e.status as string,
      sentAt: (e.sent_at as string | null) ?? null,
    }
  })

  return (
    <PortalShell userName={staff.name} userRole="Staff" dashboardHref={staff.dashboardHref} variant={staff.variant}>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">E-Signature</h2>
      <p className="text-sm text-gray-500 mb-6">
        Send documents to a borrower for e-signature through BoldSign.
      </p>

      {!isEsignEnabled() ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 max-w-2xl">
          E-signature isn&rsquo;t configured on this environment (BOLDSIGN_API_KEY is unset).
        </div>
      ) : (
        <EsignConsole
          forms={[
            // Generated package: Term Sheet rendered from the loan file
            // with the W-9 appended as its last page.
            { key: 'term_sheet', label: 'Loan Term Sheet (+ W-9)', fill: [], signerFields: [] },
            ...ESIGN_FORMS.map(f => ({
              key: f.key,
              label: f.label,
              fill: f.fill.map(({ key, label, prefill, defaultText, multiline }) => ({ key, label, prefill, defaultText, multiline })),
              signerFields: (f.signerBoxes ?? []).map(b => b.label),
            })),
          ]}
          loans={loanOptions}
          envelopes={envelopeRows}
        />
      )}
    </PortalShell>
  )
}
