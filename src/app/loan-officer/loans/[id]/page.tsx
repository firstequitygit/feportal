import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { LoanOfficerConditions } from '@/components/loan-officer-conditions'
import { AdminLoanNotes } from '@/components/admin-loan-notes'
import { LoanActivity } from '@/components/loan-activity'
import { EditableClosingDate } from '@/components/editable-closing-date'
import { EditableBorrowerPhone } from '@/components/editable-borrower-phone'
import { AdminBorrowerAssign } from '@/components/admin-borrower-assign'
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
import { LoanType } from '@/lib/types'

const LOAN_TYPES: LoanType[] = ['Fix & Flip (Bridge)', 'Rental (DSCR)', 'New Construction']
import { formatDate } from '@/lib/format-date'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

export default async function LoanOfficerLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const { data: lo } = await adminClient
    .from('loan_officers')
    .select('*')
    .eq('auth_user_id', user.id)
    .single()

  if (!lo) redirect('/login')

  // Verify this loan is assigned to this LO
  const { data: loan } = await adminClient
    .from('loans')
    .select('*, borrowers(id, full_name, email, phone, current_address_street, current_address_city, current_address_state, current_address_zip, at_current_address_2y, prior_address_street, prior_address_city, prior_address_state, prior_address_zip), loan_processors!loan_processor_id(full_name, email, phone, title), loan_processor_2:loan_processors!loan_processor_id_2(full_name, email, phone, title), underwriters(full_name, email, phone, title)')
    .eq('id', id)
    .eq('loan_officer_id', lo.id)
    .single()

  if (!loan) notFound()

  const [
    { data: conditions },
    { data: documents },
    { data: notes },
    { data: events },
    { data: allBorrowers },
    { data: loanDetails },
    { data: loanDemographics },
  ] = await Promise.all([
    adminClient.from('conditions').select('*').eq('loan_id', id).order('created_at', { ascending: true }),
    adminClient.from('documents').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('loan_notes').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('loan_events').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('borrowers').select('id, full_name, email').order('full_name'),
    adminClient.from('loan_details').select('*').eq('loan_id', id).maybeSingle(),
    adminClient.from('loan_demographics').select('*').eq('loan_id', id).maybeSingle(),
  ])

  const conditionMap: Record<string, string> = {}
  for (const c of conditions ?? []) conditionMap[c.id] = c.title

  const docsWithUrls = await Promise.all(
    (documents ?? []).map(async doc => {
      const { data } = await adminClient.storage
        .from('documents')
        .createSignedUrl(doc.file_path, 3600)
      return { ...doc, signedUrl: data?.signedUrl ?? null }
    })
  )

  const signedUrlMap: Record<string, string> = {}
  for (const doc of docsWithUrls) {
    if (doc.signedUrl) signedUrlMap[doc.id] = doc.signedUrl
  }

  const borrower = loan.borrowers as { full_name: string | null; email: string; phone: string | null } | null
  const loanProcessor = loan.loan_processors as unknown as { full_name: string; email: string | null; phone: string | null; title: string | null } | null
  const loanProcessor2 = (loan as unknown as { loan_processor_2: { full_name: string; email: string | null; phone: string | null; title: string | null } | null }).loan_processor_2
  const loanProcessors = [loanProcessor, loanProcessor2].filter((p): p is { full_name: string; email: string | null; phone: string | null; title: string | null } => !!p)
  const underwriter = loan.underwriters as unknown as { full_name: string; email: string | null; phone: string | null; title: string | null } | null

  return (
    <PortalShell userName={lo.full_name} userRole="Loan Officer" dashboardHref="/loan-officer/inbox" variant="loan-officer">
      <LoanRealtimeRefresh loanId={id} />
      <Link href="/loan-officer/loans" className="text-sm text-primary hover:opacity-80 mb-4 inline-block">
          ← Back to Loans
        </Link>

        <div className="mt-2 mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {loan.property_address ?? 'Loan Details'}
            </h2>
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
              apiEndpoint="/api/loan-officer/unclaim"
              redirectTo="/loan-officer/loans"
              roleLabel="loan officer"
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

          {/* Borrower + Loan Processor + Underwriter stacked */}
          <div className="space-y-4">
            <AdminBorrowerAssign
              loanId={id}
              currentBorrowerId={loan.borrower_id ?? null}
              currentBorrowerName={borrower?.full_name ?? null}
              allBorrowers={(allBorrowers ?? []) as { id: string; full_name: string; email: string }[]}
            />

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
                      <a href={`mailto:${borrower.email}`} className="font-medium text-primary hover:opacity-80">
                        {borrower.email}
                      </a>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Phone</span>
                      <EditableBorrowerPhone loanId={id} currentPhone={borrower.phone} />
                    </div>
                  </>
                ) : (
                  <p className="text-gray-400 italic">No borrower assigned</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">{loanProcessors.length > 1 ? 'Loan Processors' : 'Loan Processor'}</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                {loanProcessors.length === 0 ? (
                  <p className="text-gray-400 italic">No loan processor assigned</p>
                ) : loanProcessors.map((lp, i) => (
                  <div key={i} className={`space-y-2 ${i > 0 ? 'pt-3 border-t border-gray-100' : ''}`}>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Name</span>
                      <span className="font-medium">{lp.full_name}</span>
                    </div>
                    {lp.title && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Title</span>
                        <span className="font-medium">{lp.title}</span>
                      </div>
                    )}
                    {lp.email && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Email</span>
                        <a href={`mailto:${lp.email}`} className="font-medium text-primary hover:opacity-80">{lp.email}</a>
                      </div>
                    )}
                    {lp.phone && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Phone</span>
                        <span className="font-medium">{lp.phone}</span>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Underwriter</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {underwriter ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Name</span>
                      <span className="font-medium">{underwriter.full_name}</span>
                    </div>
                    {underwriter.title && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Title</span>
                        <span className="font-medium">{underwriter.title}</span>
                      </div>
                    )}
                    {underwriter.email && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Email</span>
                        <a href={`mailto:${underwriter.email}`} className="font-medium text-primary hover:opacity-80">
                          {underwriter.email}
                        </a>
                      </div>
                    )}
                    {underwriter.phone && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Phone</span>
                        <span className="font-medium">{underwriter.phone}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-gray-400 italic">No underwriter assigned</p>
                )}
              </CardContent>
            </Card>
          </div>
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
              <div className="divide-y">
                {docsWithUrls.map(doc => (
                  <div key={doc.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="text-lg mt-0.5">📄</span>
                      <div className="min-w-0">
                        {doc.signedUrl ? (
                          <DocumentPreviewLink
                            url={doc.signedUrl}
                            fileName={doc.file_name}
                            className="text-sm font-medium text-gray-900 truncate text-left hover:text-primary underline underline-offset-2 block max-w-full"
                          />
                        ) : (
                          <p className="text-sm font-medium text-gray-900 truncate">{doc.file_name}</p>
                        )}
                        {doc.condition_id && conditionMap[doc.condition_id] && (
                          <p className="text-xs text-gray-500 mt-0.5">Condition: {conditionMap[doc.condition_id]}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">
                          {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB · ` : ''}
                          {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          </CollapsibleCard>
          </div>
        )}

        {/* LO Conditions */}
        <LoanOfficerConditions
          loanId={id}
          propertyAddress={loan.property_address}
          conditions={(conditions ?? []) as Condition[]}
          documents={(documents ?? []) as Document[]}
          signedUrlMap={signedUrlMap}
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
