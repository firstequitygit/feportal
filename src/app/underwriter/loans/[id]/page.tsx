import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { UnderwriterConditions } from '@/components/underwriter-conditions'
import { AdminLoanNotes } from '@/components/admin-loan-notes'
import { LoanActivity } from '@/components/loan-activity'
import { EditableClosingDate } from '@/components/editable-closing-date'
import { EditableBorrowerPhone } from '@/components/editable-borrower-phone'
import { type Condition, type Document } from '@/lib/types'
import { LoanProgressTracker } from '@/components/loan-progress-tracker'
import { LoanRealtimeRefresh } from '@/components/loan-realtime-refresh'
import { EditableLoanStage } from '@/components/editable-loan-stage'
import { EditableLoanField } from '@/components/editable-loan-field'
import { FieldRow } from '@/components/field-row'
import { CollapsibleCard } from '@/components/collapsible-card'
import { LoanDetailsCard, type LoanDetails } from '@/components/loan-details-card'
import { UnclaimButton } from '@/components/unclaim-button'
import { BorrowerAddressCard, type BorrowerAddressFields } from '@/components/borrower-address-card'
import { LoanDemographicsCard, type LoanDemographics } from '@/components/loan-demographics-card'
import { DocumentPreviewLink } from '@/components/document-preview-link'
import { DocumentsList } from '@/components/documents-list'
import { LoanType } from '@/lib/types'

const LOAN_TYPES: LoanType[] = ['Fix & Flip (Bridge)', 'Rental (DSCR)', 'New Construction']
import { formatDate } from '@/lib/format-date'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

export default async function UnderwriterLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const { data: uw } = await adminClient
    .from('underwriters')
    .select('*')
    .eq('auth_user_id', user.id)
    .single()

  if (!uw) redirect('/login')

  const { data: loan } = await adminClient
    .from('loans')
    .select('*, borrowers(id, full_name, email, phone, current_address_street, current_address_city, current_address_state, current_address_zip, at_current_address_2y, prior_address_street, prior_address_city, prior_address_state, prior_address_zip), loan_officers(full_name, email), loan_processors!loan_processor_id(full_name, email, phone), loan_processor_2:loan_processors!loan_processor_id_2(full_name, email, phone)')
    .eq('id', id)
    .eq('underwriter_id', uw.id)
    .single()

  if (!loan) notFound()

  const [{ data: conditions }, { data: documents }, { data: templates }, { data: notes }, { data: events }, { data: loanDetails }, { data: loanDemographics }] = await Promise.all([
    adminClient.from('conditions').select('*').eq('loan_id', id).order('created_at', { ascending: true }),
    adminClient.from('documents').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('condition_templates').select('*').order('title'),
    adminClient.from('loan_notes').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('loan_events').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('loan_details').select('*').eq('loan_id', id).maybeSingle(),
    adminClient.from('loan_demographics').select('*').eq('loan_id', id).maybeSingle(),
  ])

  const conditionMap: Record<string, string> = {}
  for (const c of conditions ?? []) conditionMap[c.id] = c.title

  const docsWithUrls = await Promise.all(
    (documents ?? []).map(async doc => {
      const { data } = await adminClient.storage.from('documents').createSignedUrl(doc.file_path, 3600)
      return { ...doc, signedUrl: data?.signedUrl ?? null }
    })
  )

  // Build a doc-id → signedUrl map to pass into the conditions component
  const signedUrlMap: Record<string, string> = {}
  for (const doc of docsWithUrls) {
    if (doc.signedUrl) signedUrlMap[doc.id] = doc.signedUrl
  }

  const borrower = loan.borrowers as unknown as { full_name: string | null; email: string; phone: string | null } | null
  const loanOfficer = loan.loan_officers as unknown as { full_name: string; email: string | null } | null
  const loanProcessor = loan.loan_processors as unknown as { full_name: string; email: string | null; phone: string | null } | null
  const loanProcessor2 = (loan as unknown as { loan_processor_2: { full_name: string; email: string | null; phone: string | null } | null }).loan_processor_2
  const loanProcessors = [loanProcessor, loanProcessor2].filter((p): p is { full_name: string; email: string | null; phone: string | null } => !!p)


  return (
    <PortalShell userName={uw.full_name} userRole="Underwriter" dashboardHref="/underwriter/inbox" variant="underwriter">
      <LoanRealtimeRefresh loanId={id} />
      <Link href="/underwriter/loans" className="text-sm text-primary hover:opacity-80 mb-4 inline-block">
          ← Back to Loans
        </Link>

        <div className="mt-2 mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{loan.property_address ?? 'Loan Details'}</h2>
            <div className="text-sm text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
              <span>Stage:</span>
              <EditableLoanStage loanId={id} currentStage={loan.pipeline_stage} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/approval-letter/${id}`}
              className="text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-md whitespace-nowrap"
            >
              Generate Approval Letter
            </Link>
            <UnclaimButton
              loanId={id}
              apiEndpoint="/api/underwriter/unclaim"
              redirectTo="/underwriter/loans"
              roleLabel="underwriter"
            />
          </div>
        </div>

        <LoanProgressTracker stage={loan.pipeline_stage} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Loan Summary */}
          <Card>
            <CardHeader><CardTitle className="text-base">Loan Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <FieldRow label="Loan Number">
                <EditableLoanField loanId={id} field="loan_number" type="text" currentValue={loan.loan_number} display={loan.loan_number ?? '—'} />
              </FieldRow>
              <FieldRow label="Loan Type">
                <EditableLoanField loanId={id} field="loan_type" type="enum" options={LOAN_TYPES} currentValue={loan.loan_type} display={loan.loan_type ?? '—'} />
              </FieldRow>
              <FieldRow label="Loan Amount">
                <EditableLoanField loanId={id} field="loan_amount" type="currency" currentValue={loan.loan_amount} display={formatCurrency(loan.loan_amount)} placeholder="500000" />
              </FieldRow>
              <FieldRow label="Interest Rate">
                <EditableLoanField loanId={id} field="interest_rate" type="percent" currentValue={loan.interest_rate} display={loan.interest_rate ? `${loan.interest_rate}%` : '—'} placeholder="6.5" step="0.001" />
              </FieldRow>
              <FieldRow label="LTV">
                <EditableLoanField loanId={id} field="ltv" type="percent" currentValue={loan.ltv} display={loan.ltv ? `${loan.ltv}%` : '—'} placeholder="75" step="0.01" />
              </FieldRow>
              <FieldRow label="ARV">
                <EditableLoanField loanId={id} field="arv" type="currency" currentValue={loan.arv} display={formatCurrency(loan.arv)} placeholder="600000" />
              </FieldRow>
              <FieldRow label="Construction Budget">
                <EditableLoanField loanId={id} field="rehab_budget" type="currency" currentValue={loan.rehab_budget} display={formatCurrency(loan.rehab_budget)} placeholder="50000" />
              </FieldRow>
              <FieldRow label="Term">
                <EditableLoanField loanId={id} field="term_months" type="number" currentValue={loan.term_months} display={loan.term_months ? `${loan.term_months} months` : '—'} placeholder="360" step="1" />
              </FieldRow>
              <FieldRow label="Origination Date">
                <EditableLoanField loanId={id} field="origination_date" type="date" currentValue={loan.origination_date} display={formatDate(loan.origination_date)} />
              </FieldRow>
              <FieldRow label="Maturity Date">
                <EditableLoanField loanId={id} field="maturity_date" type="date" currentValue={loan.maturity_date} display={formatDate(loan.maturity_date)} />
              </FieldRow>
              <FieldRow label="Entity Name">
                <EditableLoanField loanId={id} field="entity_name" type="text" currentValue={loan.entity_name} display={loan.entity_name ?? '—'} inputWidthClass="w-48" />
              </FieldRow>
              <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-100">
                <span className="text-gray-500">Est. Closing Date</span>
                <EditableClosingDate loanId={id} currentDate={loan.estimated_closing_date} />
              </div>
            </CardContent>
          </Card>

          {/* Team */}
          <Card>
            <CardHeader><CardTitle className="text-base">Borrower</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {borrower ? (
                <>
                  {borrower.full_name && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Name</span>
                      <span className="font-medium">{borrower.full_name}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Email</span>
                    <a href={`mailto:${borrower.email}`} className="font-medium text-primary hover:opacity-80">{borrower.email}</a>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Phone</span>
                    <EditableBorrowerPhone loanId={id} currentPhone={borrower.phone} />
                  </div>
                </>
              ) : (
                <p className="text-gray-400 italic">No borrower assigned</p>
              )}

              <div className="border-t pt-2 mt-2 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Loan Officer</span>
                  <span className="font-medium">{loanOfficer?.full_name ?? '—'}</span>
                </div>
                {loanOfficer?.email && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">LO Email</span>
                    <a href={`mailto:${loanOfficer.email}`} className="font-medium text-primary hover:opacity-80">{loanOfficer.email}</a>
                  </div>
                )}
                {loanProcessors.length === 0 ? (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Loan Processor</span>
                    <span className="font-medium">—</span>
                  </div>
                ) : loanProcessors.map((lp, i) => (
                  <div key={i}>
                    <div className="flex justify-between">
                      <span className="text-gray-500">{loanProcessors.length > 1 ? (i === 0 ? 'Loan Processor 1' : 'Loan Processor 2') : 'Loan Processor'}</span>
                      <span className="font-medium">{lp.full_name}</span>
                    </div>
                    {lp.email && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">LP Email</span>
                        <a href={`mailto:${lp.email}`} className="font-medium text-primary hover:opacity-80">{lp.email}</a>
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-gray-500">Underwriter</span>
                  <span className="font-medium">{uw.full_name}</span>
                </div>
                {uw.email && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">UW Email</span>
                    <a href={`mailto:${uw.email}`} className="font-medium text-primary hover:opacity-80">{uw.email}</a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Loan Details (collapsible, with sub-sections) */}
        <div className="mb-6">
          <LoanDetailsCard
            loanId={id}
            loanCreatedAt={loan.created_at}
            details={(loanDetails as LoanDetails | null) ?? null}
            loanAmount={loan.loan_amount}
            interestRate={loan.interest_rate}
            termMonths={loan.term_months}
            interestOnly={loan.interest_only}
            loanArv={loan.arv}
          />
        </div>

        {/* Borrower address + Demographics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <BorrowerAddressCard
            loanId={id}
            borrower={(loan.borrowers as BorrowerAddressFields | null) ?? null}
          />
          <LoanDemographicsCard
            demographics={(loanDemographics as LoanDemographics | null) ?? null}
          />
        </div>

        {/* Documents */}
        {docsWithUrls.length > 0 && (
          <div className="mb-6">
          <CollapsibleCard
            title={
              <>
                Documents
                <span className="ml-2 text-sm font-normal text-gray-500">{docsWithUrls.length} file{docsWithUrls.length !== 1 ? 's' : ''}</span>
              </>
            }
          >
              <DocumentsList
                documents={docsWithUrls.map(d => ({
                  id: d.id,
                  file_name: d.file_name,
                  file_size: d.file_size,
                  created_at: d.created_at,
                  condition_id: d.condition_id,
                  signedUrl: d.signedUrl,
                }))}
                conditionMap={conditionMap}
                zipFilenamePrefix={loan.property_address ?? `loan-${id}`}
              />
          </CollapsibleCard>
          </div>
        )}

        <UnderwriterConditions
          loanId={id}
          loanType={loan.loan_type}
          propertyAddress={loan.property_address}
          conditions={(conditions ?? []) as Condition[]}
          documents={(documents ?? []) as Document[]}
          signedUrlMap={signedUrlMap}
          templates={templates ?? []}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <AdminLoanNotes
            loanId={id}
            initialNotes={notes ?? []}
            apiPath="/api/loans/notes"
          />
          <LoanActivity
            events={events ?? []}
            title="Activity Log"
          />
        </div>
    </PortalShell>
  )
}
