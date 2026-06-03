// Helper that computes dashboard tile values (pipeline count + volume,
// trailing-12-month closed count + volume, outstanding-condition counts)
// for a single staff member.
//
// Used by the LO / LP / UW inbox pages, which are also each role's
// landing page. Each role passes its own loan-ownership filter so the
// numbers are scoped to "loans assigned to me".
//
// The two loan lists are intentionally split because closed loans
// auto-archive 30 days after closing — counting only non-archived
// loans would lose almost the entire "Closed (Last 12 Months)" bucket.

import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

interface ActiveLoanRow {
  id: string
  pipeline_stage: string | null
  loan_amount: number | null
  loan_status: string | null
}

interface ClosedLoanRow {
  loan_amount: number | null
}

export interface DashboardMetricsInput {
  /** Non-archived loans assigned to the staff member. Drives pipeline + outstanding. */
  activeLoans: ActiveLoanRow[]
  /** Closed loans in the trailing 12 months — archived or not. Drives the
   *  "Closed (Last 12 Months)" tile. */
  closedLoansTrailing12: ClosedLoanRow[]
  /** Staff role used to count "outstanding for you" — which assignee value to match. */
  conditionAssignee: 'loan_officer' | 'loan_processor' | 'underwriter'
}

export interface DashboardMetrics {
  pipelineCount: number
  pipelineVolume: number
  onHoldCount: number
  onHoldVolume: number
  closedCountTrailing12: number
  closedVolumeTrailing12: number
  outstandingCount: number
  outstandingForYou: number
}

export async function computeDashboardMetrics(
  supabase: SupabaseAdmin,
  { activeLoans, closedLoansTrailing12, conditionAssignee }: DashboardMetricsInput,
): Promise<DashboardMetrics> {
  // Pipeline = active non-closed loans, EXCLUDING on_hold.
  // On-hold loans are paused — they don't count toward pipeline volume or
  // the "outstanding for you" tile. They get their own count below.
  const isHeld = (l: ActiveLoanRow) => (l.loan_status ?? 'active') === 'on_hold'

  const nonClosed = activeLoans.filter(l => l.pipeline_stage !== 'Closed')
  const pipeline = nonClosed.filter(l => !isHeld(l))
  const onHold = nonClosed.filter(isHeld)

  const pipelineCount  = pipeline.length
  const pipelineVolume = pipeline.reduce((s, l) => s + (l.loan_amount ?? 0), 0)
  const onHoldCount    = onHold.length
  const onHoldVolume   = onHold.reduce((s, l) => s + (l.loan_amount ?? 0), 0)

  // Closed-in-last-12-months — caller already filtered the time window
  const closedCountTrailing12  = closedLoansTrailing12.length
  const closedVolumeTrailing12 = closedLoansTrailing12.reduce((s, l) => s + (l.loan_amount ?? 0), 0)

  // Outstanding conditions across this staff member's pipeline loans.
  // "Outstanding for you" = condition assigned to this role AND status is
  // Outstanding/Rejected. (Received + Under Review don't count for LO/LP —
  // they handed it off; UW reviews Received + Under Review items, so we
  // count those for the underwriter role too.)
  let outstandingCount = 0
  let outstandingForYou = 0
  const pipelineIds = pipeline.map(l => l.id)
  if (pipelineIds.length > 0) {
    const { data: conditions } = await supabase
      .from('conditions')
      .select('assigned_to, status')
      .in('loan_id', pipelineIds)
      .or('status.eq.Outstanding,status.eq.Rejected,status.eq.Received,status.eq.Under Review')
    for (const c of conditions ?? []) {
      const blocking =
        c.status === 'Outstanding' ||
        c.status === 'Rejected' ||
        (conditionAssignee === 'underwriter' && (c.status === 'Received' || c.status === 'Under Review'))
      if (!blocking) continue
      outstandingCount++
      const isYours =
        c.assigned_to === conditionAssignee ||
        (conditionAssignee === 'underwriter' && (c.status === 'Received' || c.status === 'Under Review'))
      if (isYours) outstandingForYou++
    }
  }

  return {
    pipelineCount,
    pipelineVolume,
    onHoldCount,
    onHoldVolume,
    closedCountTrailing12,
    closedVolumeTrailing12,
    outstandingCount,
    outstandingForYou,
  }
}
