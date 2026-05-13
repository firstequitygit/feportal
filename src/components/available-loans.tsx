'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { type Loan, type PipelineStage } from '@/lib/types'

type LoanRow = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
  loan_officers?: { full_name: string } | null
  loan_processors?: { full_name: string } | null
}

interface Props {
  loans: LoanRow[]
  claimEndpoint: string
  role: 'loan_officer' | 'loan_processor' | 'underwriter'
}

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function stageBadgeColor(stage: PipelineStage | null): string {
  switch (stage) {
    case 'New Application':  return 'bg-gray-100 text-gray-700'
    case 'Processing':       return 'bg-blue-100 text-blue-700'
    case 'Pre-Underwriting': return 'bg-yellow-100 text-yellow-700'
    case 'Underwriting':     return 'bg-orange-100 text-orange-700'
    case 'Submitted':        return 'bg-green-100 text-green-700'
    case 'Closed':           return 'bg-purple-100 text-purple-700'
    default:                        return 'bg-gray-100 text-gray-600'
  }
}

function formatStage(stage: string | null): string {
  if (!stage) return 'Unknown'
  return stage.split(' /')[0].trim()
}

export function AvailableLoans({ loans, claimEndpoint, role }: Props) {
  const router = useRouter()
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const visible = loans.filter(l => !claimedIds.has(l.id))

  if (loans.length === 0) return null

  async function handleClaim(loanId: string) {
    setClaimingId(loanId)
    setError(null)
    const res = await fetch(claimEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId }),
    })
    const data = await res.json()
    if (data.success) {
      setClaimedIds(prev => new Set(prev).add(loanId))
      router.refresh()
    } else {
      setError(data.error ?? 'Failed to claim loan')
    }
    setClaimingId(null)
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Available to Claim ({visible.length})
        </h3>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md mb-3">{error}</p>
      )}

      {!collapsed && (
        <div className="space-y-3">
          {visible.length === 0 ? (
            <p className="text-sm text-gray-500">You've claimed all available loans.</p>
          ) : (
            visible.map(loan => (
              <Card key={loan.id} className="border border-dashed border-gray-300 bg-gray-50">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">
                        {loan.property_address ?? 'Address not set'}
                      </p>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {loan.borrowers?.full_name ?? 'No borrower assigned'}
                        {loan.loan_type ? ` · ${loan.loan_type}` : ''}
                        {' · '}{formatCurrency(loan.loan_amount)}
                      </p>
                      {/* Show the other role's assignment if present */}
                      {role === 'loan_processor' && loan.loan_officers?.full_name && (
                        <p className="text-xs text-gray-400 mt-1">LO: {loan.loan_officers.full_name}</p>
                      )}
                      {role === 'loan_officer' && loan.loan_processors?.full_name && (
                        <p className="text-xs text-gray-400 mt-1">LP: {loan.loan_processors.full_name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${stageBadgeColor(loan.pipeline_stage)}`}>
                        {formatStage(loan.pipeline_stage)}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => handleClaim(loan.id)}
                        disabled={claimingId === loan.id}
                      >
                        {claimingId === loan.id ? 'Claiming...' : 'Claim'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </section>
  )
}
