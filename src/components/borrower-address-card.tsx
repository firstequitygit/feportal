'use client'

import { CollapsibleCard } from '@/components/collapsible-card'
import { EditableLoanField } from '@/components/editable-loan-field'

export interface BorrowerAddressFields {
  current_address_street?: string | null
  current_address_city?: string | null
  current_address_state?: string | null
  current_address_zip?: string | null
  at_current_address_2y?: boolean | null
  prior_address_street?: string | null
  prior_address_city?: string | null
  prior_address_state?: string | null
  prior_address_zip?: string | null
}

interface Props {
  loanId: string
  borrower: BorrowerAddressFields | null
}

/**
 * Editable borrower home address — captured from the JotForm application.
 * Writes go to /api/borrowers/field (resolves the borrower from loanId).
 */
export function BorrowerAddressCard({ loanId, borrower }: Props) {
  const b = borrower ?? {}
  return (
    <CollapsibleCard title="Borrower Address">
      <div className="space-y-2 text-sm">
        <p className="text-xs text-gray-500 italic">Borrower&apos;s primary residence (not the subject property).</p>

        <Row label="Street">
          <EditableLoanField
            loanId={loanId}
            apiEndpoint="/api/borrowers/field"
            field="current_address_street"
            type="text"
            currentValue={b.current_address_street ?? null}
            display={b.current_address_street ?? '—'}
            inputWidthClass="w-56"
          />
        </Row>
        <Row label="City">
          <EditableLoanField
            loanId={loanId}
            apiEndpoint="/api/borrowers/field"
            field="current_address_city"
            type="text"
            currentValue={b.current_address_city ?? null}
            display={b.current_address_city ?? '—'}
          />
        </Row>
        <Row label="State">
          <EditableLoanField
            loanId={loanId}
            apiEndpoint="/api/borrowers/field"
            field="current_address_state"
            type="text"
            currentValue={b.current_address_state ?? null}
            display={b.current_address_state ?? '—'}
            inputWidthClass="w-20"
          />
        </Row>
        <Row label="ZIP">
          <EditableLoanField
            loanId={loanId}
            apiEndpoint="/api/borrowers/field"
            field="current_address_zip"
            type="text"
            currentValue={b.current_address_zip ?? null}
            display={b.current_address_zip ?? '—'}
            inputWidthClass="w-24"
          />
        </Row>
        <Row label="At Current Address 2+ Yrs?">
          <EditableLoanField
            loanId={loanId}
            apiEndpoint="/api/borrowers/field"
            field="at_current_address_2y"
            type="boolean"
            currentValue={b.at_current_address_2y ?? false}
          />
        </Row>

        <div className="pt-2 mt-1 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">Prior address (if less than 2 years at current)</p>
          <div className="space-y-2">
            <Row label="Street">
              <EditableLoanField
                loanId={loanId}
                apiEndpoint="/api/borrowers/field"
                field="prior_address_street"
                type="text"
                currentValue={b.prior_address_street ?? null}
                display={b.prior_address_street ?? '—'}
                inputWidthClass="w-56"
              />
            </Row>
            <Row label="City">
              <EditableLoanField
                loanId={loanId}
                apiEndpoint="/api/borrowers/field"
                field="prior_address_city"
                type="text"
                currentValue={b.prior_address_city ?? null}
                display={b.prior_address_city ?? '—'}
              />
            </Row>
            <Row label="State">
              <EditableLoanField
                loanId={loanId}
                apiEndpoint="/api/borrowers/field"
                field="prior_address_state"
                type="text"
                currentValue={b.prior_address_state ?? null}
                display={b.prior_address_state ?? '—'}
                inputWidthClass="w-20"
              />
            </Row>
            <Row label="ZIP">
              <EditableLoanField
                loanId={loanId}
                apiEndpoint="/api/borrowers/field"
                field="prior_address_zip"
                type="text"
                currentValue={b.prior_address_zip ?? null}
                display={b.prior_address_zip ?? '—'}
                inputWidthClass="w-24"
              />
            </Row>
          </div>
        </div>
      </div>
    </CollapsibleCard>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-gray-500">{label}</span>
      {children}
    </div>
  )
}
