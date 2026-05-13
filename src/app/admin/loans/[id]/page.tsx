import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type Condition, type ConditionTemplate } from '@/lib/types'
import { LoanProgressTracker } from '@/components/loan-progress-tracker'
import { LoanRealtimeRefresh } from '@/components/loan-realtime-refresh'
import { CollapsibleCard } from '@/components/collapsible-card'
import { EditableLoanStage } from '@/components/editable-loan-stage'
import { EditableLoanField } from '@/components/editable-loan-field'
import { FieldRow } from '@/components/field-row'
import { LoanDetailsCard, type LoanDetails } from '@/components/loan-details-card'
import { BorrowerAddressCard, type BorrowerAddressFields } from '@/components/borrower-address-card'
import { LoanDemographicsCard, type LoanDemographics } from '@/components/loan-demographics-card'
import { LoanType } from '@/lib/types'

const LOAN_TYPES: LoanType[] = ['Fix & Flip (Bridge)', 'Rental (DSCR)', 'New Construction']
import { PortalShell } from '@/components/portal-shell'
import { AdminConditionsManager } from '@/components/admin-conditions-manager'
import { AdminBorrowerAssign } from '@/components/admin-borrower-assign'
import { AdminLoanOfficerAssign } from '@/components/admin-loan-officer-assign'
import { AdminLoanProcessorAssign } from '@/components/admin-loan-processor-assign'
import { AdminLoanNotes } from '@/components/admin-loan-notes'
import { LoanActivity } from '@/components/loan-activity'
import { EditableClosingDate } from '@/components/editable-closing-date'
import { DocumentPreviewLink } from '@/components/document-preview-link'
import { formatDate } from '@/lib/format-date'
import { AdminArchiveButton } from '@/components/admin-archive-button'
import { AdminUnderwriterAssign } from '@/components/admin-underwriter-assign'
import Link from 'next/link'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function AdminLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
    { data: loan },
    { data: conditions },
    { data: templates },
    { data: allBorrowers },
    { data: documents },
    { data: notes },
    { data: events },
    { data: archivedIds },
    { data: allLoanOfficers },
    { data: allLoanProcessors },
    { data: allUnderwriters },
    { data: loanDetails },
    { data: loanDemographics },
  ] = await Promise.all([
    adminClient.from('loans').select('*, borrowers(id, full_name, email, phone, current_address_street, current_address_city, current_address_state, current_address_zip, at_current_address_2y, prior_address_street, prior_address_city, prior_address_state, prior_address_zip), loan_officers(id, full_name, email, phone, title), loan_processors!loan_processor_id(id, full_name, email, phone, title), loan_processor_2:loan_processors!loan_processor_id_2(id, full_name, email, phone, title), underwriters(id, full_name, email, phone, title)').eq('id', id).single(),
    adminClient.from('conditions').select('*').eq('loan_id', id).order('created_at', { ascending: true }),
    adminClient.from('condition_templates').select('*').order('title'),
    adminClient.from('borrowers').select('id, full_name, email').order('full_name'),
    adminClient.from('documents').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('loan_notes').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('loan_events').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.rpc('get_archived_loan_ids'),
    adminClient.from('loan_officers').select('id, full_name, email, phone, title').order('full_name'),
    adminClient.from('loan_processors').select('id, full_name, email, phone, title').order('full_name'),
    adminClient.from('underwriters').select('id, full_name, email, phone, title').order('full_name'),
    adminClient.from('loan_details').select('*').eq('loan_id', id).maybeSingle(),
    adminClient.from('loan_demographics').select('*').eq('loan_id', id).maybeSingle(),
  ])

  if (!loan) notFound()

  const isArchived = (archivedIds ?? []).some((r: { loan_id: string }) => r.loan_id === id)

  // Generate signed download URLs for each document (valid for 1 hour)
  const docsWithUrls = await Promise.all(
    (documents ?? []).map(async doc => {
      const { data } = await adminClient.storage
        .from('documents')
        .createSignedUrl(doc.file_path, 3600)
      return { ...doc, signedUrl: data?.signedUrl ?? null }
    })
  )

  // Group documents by condition for display
  const conditionMap: Record<string, string> = {}
  for (const c of conditions ?? []) {
    conditionMap[c.id] = c.title
  }

  return (
    <PortalShell userName={null} userRole="Administrator" dashboardHref="/admin" variant="admin" maxWidth="max-w-5xl">
      <LoanRealtimeRefresh loanId={id} />
      <Link href="/admin" className="text-sm text-primary hover:opacity-80 mb-4 inline-block">
          ← Back to Overview
        </Link>

        <div className="flex items-start justify-between gap-4 mt-2 mb-2">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {loan.property_address ?? 'Loan Details'}
            </h2>
            <div className="text-sm text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
              <span>Stage:</span>
              <EditableLoanStage loanId={id} currentStage={loan.pipeline_stage} />
              <span>&bull; Pipedrive Deal #{loan.pipedrive_deal_id}</span>
              {isArchived && (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Archived</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/approval-letter/${id}`}
              className="text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-md whitespace-nowrap"
            >
              Generate Approval Letter
            </Link>
            <AdminArchiveButton loanId={id} archived={isArchived} />
          </div>
        </div>

        <LoanProgressTracker stage={loan.pipeline_stage} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {/* Loan Summary */}
          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-base">Loan Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <FieldRow label="Loan Number">
                <EditableLoanField loanId={id} field="loan_number" type="text" currentValue={loan.loan_number} display={loan.loan_number ?? '—'} />
              </FieldRow>
              <FieldRow label="Loan Type">
                <EditableLoanField loanId={id} field="loan_type" type="enum" options={LOAN_TYPES} currentValue={loan.loan_type} display={loan.loan_type ?? '—'} />
              </FieldRow>
              <FieldRow label="Loan Type II">
                <span className="font-medium">{loan.loan_type_ii ?? '—'}</span>
              </FieldRow>
              <FieldRow label="Loan Amount">
                <EditableLoanField loanId={id} field="loan_amount" type="currency" currentValue={loan.loan_amount} display={formatCurrency(loan.loan_amount)} placeholder="500000" />
              </FieldRow>
              <FieldRow label="Interest Rate">
                <EditableLoanField loanId={id} field="interest_rate" type="percent" currentValue={loan.interest_rate} display={loan.interest_rate ? `${loan.interest_rate}%` : '—'} placeholder="6.5" step="0.001" />
              </FieldRow>
              <FieldRow label="Interest Only">
                <span className="font-medium">{loan.interest_only ?? '—'}</span>
              </FieldRow>
              <FieldRow label="Rate Locked / Days">
                <span className="font-medium">{loan.rate_locked_days ?? '—'}</span>
              </FieldRow>
              <FieldRow label="Rate Lock Expiration">
                <span className="font-medium">{formatDate(loan.rate_lock_expiration_date)}</span>
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

          {/* Assignments — stacked vertically */}
          <div className="space-y-4">
            <AdminBorrowerAssign
              loanId={id}
              currentBorrowerId={loan.borrowers?.id ?? null}
              currentBorrowerName={loan.borrowers?.full_name ?? null}
              allBorrowers={(allBorrowers ?? []) as { id: string; full_name: string; email: string }[]}
            />

            <AdminLoanOfficerAssign
              loanId={id}
              currentLoanOfficerId={loan.loan_officers?.id ?? null}
              allLoanOfficers={(allLoanOfficers ?? []) as { id: string; auth_user_id: string | null; full_name: string; email: string | null; phone: string | null; title: string | null; created_at: string }[]}
            />

            <AdminLoanProcessorAssign
              loanId={id}
              currentLoanProcessorId={loan.loan_processors?.id ?? null}
              currentLoanProcessorId2={(loan as unknown as { loan_processor_2: { id: string } | null }).loan_processor_2?.id ?? null}
              allLoanProcessors={(allLoanProcessors ?? []) as { id: string; auth_user_id: string | null; full_name: string; email: string | null; phone: string | null; title: string | null; created_at: string }[]}
            />

            <AdminUnderwriterAssign
              loanId={id}
              currentUnderwriterId={loan.underwriters?.id ?? null}
              allUnderwriters={(allUnderwriters ?? []) as { id: string; auth_user_id: string | null; full_name: string; email: string | null; phone: string | null; title: string | null; created_at: string }[]}
            />
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

        {/* Borrower address + Demographics — split 50/50 */}
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
        <div className="mb-6">
        <CollapsibleCard
          title={
            <>
              Documents
              <span className="ml-2 text-sm font-normal text-gray-500">
                {docsWithUrls.length} uploaded
              </span>
            </>
          }
        >
            {docsWithUrls.length === 0 ? (
              <p className="text-sm text-gray-500">No documents uploaded yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {docsWithUrls.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-gray-400 shrink-0">📄</span>
                      <div className="min-w-0">
                        {doc.signedUrl ? (
                          <DocumentPreviewLink
                            url={doc.signedUrl}
                            fileName={doc.file_name}
                            className="text-sm text-gray-900 truncate text-left hover:text-primary underline underline-offset-2 block max-w-full"
                          />
                        ) : (
                          <p className="text-sm text-gray-900 truncate">{doc.file_name}</p>
                        )}
                        {doc.condition_id && conditionMap[doc.condition_id] && (
                          <p className="text-xs text-gray-400 truncate">
                            {conditionMap[doc.condition_id]}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {doc.file_size && (
                        <span className="text-xs text-gray-400 hidden sm:block">
                          {formatFileSize(doc.file_size)}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">
                        {new Date(doc.created_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </CollapsibleCard>
        </div>

        {/* Conditions Manager */}
        <AdminConditionsManager
          loanId={id}
          loanType={loan.loan_type}
          conditions={(conditions ?? []) as Condition[]}
          templates={(templates ?? []) as ConditionTemplate[]}
          propertyAddress={loan.property_address}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {/* Staff Notes */}
          <AdminLoanNotes
            loanId={id}
            initialNotes={notes ?? []}
          />

          {/* Activity Log */}
          <LoanActivity
            events={events ?? []}
            title="Activity Log"
          />
        </div>
    </PortalShell>
  )
}
