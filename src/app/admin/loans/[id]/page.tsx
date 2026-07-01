import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCookieImpersonationForShell } from '@/lib/impersonate'
import { fetchAllBorrowers, fetchAllBrokers } from '@/lib/fetch-all-borrowers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type Condition, type ConditionTemplate } from '@/lib/types'
import { LoanProgressTracker } from '@/components/loan-progress-tracker'
import { LoanRealtimeRefresh } from '@/components/loan-realtime-refresh'
import { CollapsibleCard } from '@/components/collapsible-card'
import { EditableBorrowerContact } from '@/components/editable-borrower-contact'
import { EditableLoanStage } from '@/components/editable-loan-stage'
import { LoanStatusControl } from '@/components/loan-status-control'
import { EditableLoanField } from '@/components/editable-loan-field'
import { FieldRow } from '@/components/field-row'
import { LoanDetailsCard, type LoanDetails } from '@/components/loan-details-card'
import { fetchLoanDetailViews } from '@/lib/fetch-loan-detail-views'
import { formatLoanName } from '@/lib/format-loan-name'
import { CopyableAddress } from '@/components/copyable-address'
import { BorrowerAddressCard, type BorrowerAddressFields } from '@/components/borrower-address-card'
import { LoanDemographicsCard, type LoanDemographics } from '@/components/loan-demographics-card'
import { LoanType } from '@/lib/types'

const LOAN_TYPES: LoanType[] = ['Fix & Flip (Bridge)', 'Rental (DSCR)', 'New Construction']
import { PortalShell } from '@/components/portal-shell'
import { AdminConditionsManager } from '@/components/admin-conditions-manager'
import { AdminBorrowerAssign } from '@/components/admin-borrower-assign'
import { CoBorrowersAssign } from '@/components/co-borrowers-assign'
import { BrokerAssign } from '@/components/broker-assign'
import { AdminLoanOfficerAssign } from '@/components/admin-loan-officer-assign'
import { AdminLoanProcessorAssign } from '@/components/admin-loan-processor-assign'
import { AdminLoanNotes } from '@/components/admin-loan-notes'
import { fetchMentionableStaff } from '@/lib/mentionable-staff'
import { LoanActivity } from '@/components/loan-activity'
import { EditableClosingDate } from '@/components/editable-closing-date'
import { DocumentPreviewLink } from '@/components/document-preview-link'
import { DocumentsList } from '@/components/documents-list'
import { formatDate } from '@/lib/format-date'
import { ViewAsDropdown } from '@/components/view-as-dropdown'
import { buildViewAsOptions } from '@/lib/view-as-options'
import { formatInterestRate } from '@/lib/format-interest-rate'
import { AdminArchiveButton } from '@/components/admin-archive-button'
import { LoanAirtableSyncButton } from '@/components/loan-airtable-sync-button'
import { LoanDocGeneratorMenu } from '@/components/loan-doc-generator-menu'
import { AdminUnderwriterAssign } from '@/components/admin-underwriter-assign'
import { AdminChargeFee } from '@/components/admin-charge-fee'
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
  const impersonation = await getCookieImpersonationForShell(adminClient, user.id)

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
    { data: allBrokers },
    { data: loanDetails },
    { data: loanDemographics },
  ] = await Promise.all([
    adminClient.from('loans').select('*, borrowers!borrower_id(id, auth_user_id, full_name, email, phone, current_address_street, current_address_city, current_address_state, current_address_zip, at_current_address_2y, prior_address_street, prior_address_city, prior_address_state, prior_address_zip), brokers!broker_id(id, full_name, email, company_name, phone),broker_2:brokers!broker_id_2(id, full_name, email, company_name, phone), loan_officers(id, full_name, email, phone, title), loan_processors!loan_processor_id(id, full_name, email, phone, title), loan_processor_2:loan_processors!loan_processor_id_2(id, full_name, email, phone, title), underwriters(id, full_name, email, phone, title)').eq('id', id).single(),
    adminClient.from('conditions').select('*').eq('loan_id', id).order('created_at', { ascending: true }),
    adminClient.from('condition_templates').select('*').order('title'),
    fetchAllBorrowers(adminClient).then(rows => ({ data: rows })),
    adminClient.from('documents').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('loan_notes').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.from('loan_events').select('*').eq('loan_id', id).order('created_at', { ascending: false }),
    adminClient.rpc('get_archived_loan_ids'),
    adminClient.from('loan_officers').select('id, full_name, email, phone, title').order('full_name'),
    adminClient.from('loan_processors').select('id, full_name, email, phone, title').order('full_name'),
    adminClient.from('underwriters').select('id, full_name, email, phone, title').order('full_name'),
    fetchAllBrokers(adminClient).then(rows => ({ data: rows })),
    adminClient.from('loan_details').select('*').eq('loan_id', id).maybeSingle(),
    adminClient.from('loan_demographics').select('*').eq('loan_id', id).maybeSingle(),
  ])

  if (!loan) notFound()

  // Fetch linked loan application for the fee-charge fallback section.
  // Some older loans have no linked application row - guard for null below.
  const { data: loanApplication } = await adminClient
    .from('loan_applications')
    .select('id, square_card_id, card_brand, card_last4, fee_amount_cents, fee_charged_at, fee_charge_status')
    .eq('submitted_loan_id', id)
    .maybeSingle()

  // Staff directory for @mention autocomplete in Staff Notes / condition
  // notes. Includes admins, which fetchStaffDirectory doesn't.
  const mentionableStaff = await fetchMentionableStaff()

  // This staff user's saved Loan Details views — drives the in-card
  // picker and the manage-views modal. Empty list = no views saved
  // yet, picker still renders so they can open the manager to create
  // their first one.
  const detailViewBundle = await fetchLoanDetailViews(adminClient, user.id)

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
    <PortalShell userName={admin.full_name} userRole="Administrator" dashboardHref="/admin" variant="admin" isSuperAdmin={admin.is_super ?? false} impersonation={impersonation} maxWidth="max-w-5xl">
      <LoanRealtimeRefresh loanId={id} />
      <Link href="/admin" className="text-sm text-primary hover:opacity-80 mb-4 inline-block">
          ← Back to Overview
        </Link>

        <div className="flex items-start justify-between gap-4 mt-2 mb-2">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {formatLoanName({
                borrowerName: (loan.borrowers as { full_name: string | null } | null)?.full_name ?? null,
                propertyAddress: loan.property_address,
                loanNumber: loan.loan_number,
              })}
            </h2>
            <CopyableAddress address={loan.property_address} />
            <div className="text-sm text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
              <span>Stage:</span>
              <EditableLoanStage loanId={id} currentStage={loan.pipeline_stage} />
              <span>&bull; Pipedrive Deal #{loan.pipedrive_deal_id}</span>
              {isArchived && (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Archived</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <ViewAsDropdown loanId={id} options={buildViewAsOptions(loan, { includeStaff: true })} />
            <LoanAirtableSyncButton loanId={id} />
            <LoanDocGeneratorMenu loanId={id} />
            <AdminArchiveButton loanId={id} archived={isArchived} />
          </div>
        </div>

        <LoanStatusControl
          loanId={id}
          currentStatus={(loan.loan_status ?? 'active') as 'active' | 'on_hold' | 'cancelled'}
          cancellationReason={loan.cancellation_reason ?? null}
        />

        <LoanProgressTracker stage={loan.pipeline_stage} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 items-start">
          {/* Left column: Loan Summary + internal staff assignments */}
          <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Loan Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <FieldRow label="Loan Officer">
                <span className="font-medium text-gray-700">{(loan.loan_officers as { full_name: string | null } | null)?.full_name ?? '—'}</span>
              </FieldRow>
              <FieldRow label="Loan Number">
                <EditableLoanField loanId={id} field="loan_number" type="text" currentValue={loan.loan_number} display={loan.loan_number ?? '—'} />
              </FieldRow>
              <FieldRow label="Loan Type">
                <EditableLoanField loanId={id} field="loan_type" type="enum" options={LOAN_TYPES} currentValue={loan.loan_type} display={loan.loan_type ?? '—'} />
              </FieldRow>
              <FieldRow label="Loan Purpose">
                {/* Mirror of the Loan Purpose row inside the Loan Details
                    card. Same backing field (loan_details.loan_type_one,
                    historically named "Loan Type I") so editing either
                    place updates both. */}
                <EditableLoanField
                  loanId={id}
                  field="loan_type_one"
                  type="enum"
                  options={['Purchase', 'Refinance (no cash out)', 'Refinance (cash out)', 'Delayed Purchase']}
                  currentValue={(loanDetails as LoanDetails | null)?.loan_type_one ?? null}
                  display={(loanDetails as LoanDetails | null)?.loan_type_one ?? '—'}
                />
              </FieldRow>
              <FieldRow label="Loan Amount">
                <EditableLoanField loanId={id} field="loan_amount" type="currency" currentValue={loan.loan_amount} display={formatCurrency(loan.loan_amount)} placeholder="500000" />
              </FieldRow>
              <FieldRow label="Interest Rate">
                <EditableLoanField loanId={id} field="interest_rate" type="percent" currentValue={loan.interest_rate} display={formatInterestRate(loan.interest_rate)} placeholder="6.5" step="0.001" />
              </FieldRow>
              <FieldRow label="Interest Only">
                <EditableLoanField loanId={id} field="interest_only" type="enum" options={['Yes', 'No']} currentValue={loan.interest_only} display={loan.interest_only ?? '—'} />
              </FieldRow>
              <FieldRow label="Rate Locked / Days">
                <EditableLoanField loanId={id} field="rate_locked_days" type="enum" options={['No', '15 days', '30 days', '45 days']} currentValue={loan.rate_locked_days} display={loan.rate_locked_days ?? '—'} />
              </FieldRow>
              <FieldRow label="Rate Lock Date">
                <EditableLoanField loanId={id} field="rate_lock_date" type="date" currentValue={loan.rate_lock_date} display={formatDate(loan.rate_lock_date)} />
              </FieldRow>
              <FieldRow label="Rate Lock Expiration">
                <EditableLoanField loanId={id} field="rate_lock_expiration_date" type="date" currentValue={loan.rate_lock_expiration_date} display={formatDate(loan.rate_lock_expiration_date)} />
              </FieldRow>
              <FieldRow label="Rate Lock Extended">
                <EditableLoanField loanId={id} field="rate_lock_extended" type="enum" options={['Yes', 'No']} currentValue={loan.rate_lock_extended} display={loan.rate_lock_extended ?? '—'} />
              </FieldRow>
              {loan.rate_lock_extended === 'Yes' && (
                // Soft hint pointing staff at where to record the cost
                // breakdown — the points fields live on loan_details.
                <p className="text-[11px] text-gray-400 italic -mt-1">
                  Extension costs are tracked in Loan Details → Loan Terms below.
                </p>
              )}
              <FieldRow label="Value (As-Is)">
                <EditableLoanField
                  loanId={id}
                  field="value_as_is"
                  type="currency"
                  currentValue={(loanDetails as LoanDetails | null)?.value_as_is ?? null}
                  display={formatCurrency((loanDetails as LoanDetails | null)?.value_as_is ?? null)}
                  placeholder="500000"
                />
              </FieldRow>
              <FieldRow label="LTV">
                {loan.loan_type === 'Rental (DSCR)' ? (
                  <span className="font-medium text-gray-700" title="Auto-calculated from Loan Amount ÷ Value (As-Is)">
                    {loan.ltv ? `${loan.ltv}%` : '—'}
                  </span>
                ) : (
                  <EditableLoanField loanId={id} field="ltv" type="percent" currentValue={loan.ltv} display={loan.ltv ? `${loan.ltv}%` : '—'} placeholder="75" step="0.01" />
                )}
              </FieldRow>
              {/* ARV + Construction Budget are not relevant for DSCR rentals */}
              {loan.loan_type !== 'Rental (DSCR)' && (
                <>
                  <FieldRow label="Value (ARV)">
                    <EditableLoanField loanId={id} field="arv" type="currency" currentValue={loan.arv} display={formatCurrency(loan.arv)} placeholder="600000" />
                  </FieldRow>
                  <FieldRow label="Construction Budget">
                    <EditableLoanField loanId={id} field="rehab_budget" type="currency" currentValue={loan.rehab_budget} display={formatCurrency(loan.rehab_budget)} placeholder="50000" />
                  </FieldRow>
                </>
              )}
              <FieldRow label="Term">
                <EditableLoanField loanId={id} field="term_months" type="number" currentValue={loan.term_months} display={loan.term_months ? `${loan.term_months} months` : '—'} placeholder="360" step="1" />
              </FieldRow>
              {/* Origination Date + Maturity Date moved to Loan / Deal
                  Overview inside the Loan Details card. */}
              <FieldRow label="Entity Name">
                <EditableLoanField loanId={id} field="entity_name" type="text" currentValue={loan.entity_name} display={loan.entity_name ?? '—'} inputWidthClass="w-48" />
              </FieldRow>
              <FieldRow label="Funding Source">
                <EditableLoanField loanId={id} field="funding_source" type="enum" options={['In House', 'RAI']} currentValue={loan.funding_source} display={loan.funding_source ?? '—'} />
              </FieldRow>
              <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-100">
                <span className="text-gray-500">Est. Closing Date</span>
                <EditableClosingDate loanId={id} currentDate={loan.estimated_closing_date} />
              </div>
            </CardContent>
          </Card>

            <AdminLoanOfficerAssign
              loanId={id}
              currentLoanOfficerId={loan.loan_officers?.id ?? null}
              allLoanOfficers={(allLoanOfficers ?? []) as { id: string; auth_user_id: string | null; full_name: string; email: string | null; phone: string | null; title: string | null; pipedrive_user_id: number | null; created_at: string }[]}
            />

            {loanApplication && (
              <AdminChargeFee
                loanId={id}
                feeCents={loanApplication.fee_amount_cents ?? null}
                chargedAt={loanApplication.fee_charged_at ?? null}
                last4={loanApplication.card_last4 ?? null}
                brand={loanApplication.card_brand ?? null}
                squareCardId={loanApplication.square_card_id ?? null}
                feeChargeStatus={loanApplication.fee_charge_status ?? null}
              />
            )}

            <AdminLoanProcessorAssign
              loanId={id}
              currentLoanProcessorId={loan.loan_processors?.id ?? null}
              currentLoanProcessorId2={(loan as unknown as { loan_processor_2: { id: string } | null }).loan_processor_2?.id ?? null}
              allLoanProcessors={(allLoanProcessors ?? []) as { id: string; auth_user_id: string | null; full_name: string; email: string | null; phone: string | null; title: string | null; is_ops_manager: boolean; created_at: string }[]}
            />

            <AdminUnderwriterAssign
              loanId={id}
              currentUnderwriterId={loan.underwriters?.id ?? null}
              allUnderwriters={(allUnderwriters ?? []) as { id: string; auth_user_id: string | null; full_name: string; email: string | null; phone: string | null; title: string | null; created_at: string }[]}
            />
          </div>

          {/* Right column: outside contacts (broker + borrowers) */}
          <div className="space-y-4">
            <BrokerAssign
              loanId={id}
              currentBrokerId={loan.broker_id ?? null}
              currentBrokerId2={loan.broker_id_2 ?? null}
              allBrokers={(allBrokers ?? []) as { id: string; full_name: string | null; email: string; company_name: string | null }[]}
            />

            <AdminBorrowerAssign
              loanId={id}
              currentBorrowerId={loan.borrowers?.id ?? null}
              currentBorrowerName={loan.borrowers?.full_name ?? null}
              allBorrowers={(allBorrowers ?? []) as { id: string; full_name: string; email: string }[]}
            />

            {loan.borrowers && (
              <CollapsibleCard title="Borrower Contact">
                <div className="text-sm">
                  <EditableBorrowerContact
                    loanId={id}
                    borrower={loan.borrowers as { auth_user_id: string | null; full_name: string | null; email: string; phone: string | null }}
                  />
                </div>
              </CollapsibleCard>
            )}

            <CoBorrowersAssign
              loanId={id}
              currentSlots={{
                slot2: loan.borrower_id_2 ?? null,
                slot3: loan.borrower_id_3 ?? null,
                slot4: loan.borrower_id_4 ?? null,
              }}
              allBorrowers={(allBorrowers ?? []) as { id: string; full_name: string; email: string }[]}
              primaryBorrowerId={loan.borrowers?.id ?? null}
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
            originationDate={loan.origination_date}
            maturityDate={loan.maturity_date}
            views={detailViewBundle.views}
            defaultViewId={detailViewBundle.defaultViewId}
            initialHiddenFields={detailViewBundle.initialHiddenFields}
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
              // Admin-only: only this page passes canDelete, so the
              // delete button never appears on LO/LP/UW or borrower
              // /broker Documents sections.
              canDelete
            />
        </CollapsibleCard>
        </div>

        {/* Conditions Manager */}
        <AdminConditionsManager
          loanId={id}
          loanType={loan.loan_type}
          conditions={(conditions ?? []) as Condition[]}
          templates={(templates ?? []) as ConditionTemplate[]}
          propertyAddress={loan.property_address}
          underwriterName={loan.underwriters?.full_name ?? null}
          hasReminderRecipient={!!(loan.borrower_id || loan.borrower_id_2 || loan.borrower_id_3 || loan.borrower_id_4 || loan.broker_id || loan.broker_id_2)}
        />

        {/* Staff Notes full-width (2-up note buckets inside), Activity
            Log stacked below. */}
        <div className="space-y-6 mt-6">
          {/* Staff Notes */}
          <AdminLoanNotes
            loanId={id}
            initialNotes={notes ?? []}
            mentionableStaff={mentionableStaff}
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

// buildViewAsOptions lives in src/components/view-as-dropdown.tsx so the
// LO and LP pages can reuse it.
