// Helper that computes dashboard tile values (pipeline count + volume,
// trailing-12-month closed count + volume, outstanding-condition counts)
// for a single staff member.
//
// Used by the LO / LP / UW inbox pages, which are also each role's
// landing page. Each role passes its own loan-ownership filter so the
// numbers are scoped to "loans assigned to me".

import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

interface LoanRow {
  id: string
  pipeline_stage: string | null
  loan_amount: number | null
  closed_at: string | null
}

export interface DashboardMetricsInput {
  /** All loans assigned to the staff member, non-archived. Pass the already-fetched
   *  array if the caller has it; otherwise pass a fetcher that yields the array. */
  loans: LoanRow[]
  /** Staff role used to count "outstanding for you" — which assignee value to match. */
  conditionAssignee: 'loan_officer' | 'loan_processor' | 'underwriter'
}

export interface DashboardMetrics {
  pipelineCount: number
  pipelineVolume: number
  closedCountTrailing12: number
  closedVolumeTrailing12: number
  outstandingCount: number
  outstandingForYou: number
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

export async function computeDashboardMetrics(
  supabase: SupabaseAdmin,
  { loans, conditionAssignee }: DashboardMetricsInput,
): Promise<DashboardMetrics> {
  // Pipeline = non-closed loans (closed loans count toward the closed tile)
  const pipeline = loans.filter(l => l.pipeline_stage !== 'Closed')
  const pipelineCount  = pipeline.length
  const pipelineVolume = pipeline.reduce((s, l) => s + (l.loan_amount ?? 0), 0)

  // Closed in the trailing 12 months. Uses closed_at (Pipedrive won_time)
  // which we populate on every sync for status=won deals.
  const cutoff = Date.now() - ONE_YEAR_MS
  const closed = loans.filter(l =>
    l.pipeline_stage === 'Closed' &&
    l.closed_at &&
    new Date(l.closed_at).getTime() >= cutoff
  )
  const closedCountTrailing12  = closed.length
  const closedVolumeTrailing12 = closed.reduce((s, l) => s + (l.loan_amount ?? 0), 0)

  // Outstanding conditions across this staff member's pipeline loans.
  // "Outstanding for you" = condition assigned to this role AND status is
  // Outstanding/Rejected. (Received doesn't count for LO/LP — they handed
  // it off; UW reviews Received items, so we also count Received when role
  // is underwriter.)
  let outstandingCount = 0
  let outstandingForYou = 0
  const pipelineIds = pipeline.map(l => l.id)
  if (pipelineIds.length > 0) {
    const { data: conditions } = await supabase
      .from('conditions')
      .select('assigned_to, status')
      .in('loan_id', pipelineIds)
      .or('status.eq.Outstanding,status.eq.Rejected,status.eq.Received')
    for (const c of conditions ?? []) {
      const blocking =
        c.status === 'Outstanding' ||
        c.status === 'Rejected' ||
        (conditionAssignee === 'underwriter' && c.status === 'Received')
      if (!blocking) continue
      outstandingCount++
      const isYours =
        c.assigned_to === conditionAssignee ||
        (conditionAssignee === 'underwriter' && c.status === 'Received')
      if (isYours) outstandingForYou++
    }
  }

  return {
    pipelineCount,
    pipelineVolume,
    closedCountTrailing12,
    closedVolumeTrailing12,
    outstandingCount,
    outstandingForYou,
  }
}
