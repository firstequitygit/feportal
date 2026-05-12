'use client'

import { CollapsibleCard } from '@/components/collapsible-card'

export interface LoanDemographics {
  ethnicity: string | null
  race: string | null
  sex: string | null
}

interface Props {
  demographics: LoanDemographics | null
}

/**
 * Read-only display of HMDA-style demographic data captured from the
 * application. Kept on a separate card (and a separate `loan_demographics`
 * table) for compliance / privacy isolation. Not editable from the portal —
 * if a value needs correcting, the borrower must re-submit.
 */
export function LoanDemographicsCard({ demographics }: Props) {
  const d = demographics
  const hasAny = d && (d.ethnicity || d.race || d.sex)
  return (
    <CollapsibleCard title="Demographics (HMDA)">
      <div className="space-y-2 text-sm">
        <p className="text-xs text-gray-500 italic">
          Government-monitoring information from the loan application; read-only.
          Borrowers may decline to provide.
        </p>
        {hasAny ? (
          <>
            <Row label="Ethnicity" value={d?.ethnicity ?? null} />
            <Row label="Race" value={d?.race ?? null} />
            <Row label="Sex" value={d?.sex ?? null} />
          </>
        ) : (
          <p className="text-gray-400 italic">No demographic data on file for this loan.</p>
        )}
      </div>
    </CollapsibleCard>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value ?? '—'}</span>
    </div>
  )
}
