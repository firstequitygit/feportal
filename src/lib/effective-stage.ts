// Decides what pipeline_stage to write when Pipedrive sends a value
// that disagrees with what the portal currently holds.
//
// Two protections layered on top of "trust Pipedrive":
//
// 1. CA preservation (existing rule):
//    portal = 'Conditionally Approved' AND pipedrive = 'Underwriting'
//      → keep 'Conditionally Approved'
//    Conditionally Approved is portal-only; Pipedrive keeps such deals in
//    Underwriting, and the sync used to flip them back.
//
// 2. Forward-stage protection (new — added after 1023 Monroe Ave was
//    silently walked back from Approved to Underwriting by a webhook):
//    If portal is at a later stage than Pipedrive, ignore the Pipedrive
//    value. Staff intentionally moved the loan forward; we don't want a
//    stray Pipedrive update to roll it back.
//
// Forward stage moves (Pipedrive ahead of portal) still propagate, so
// staff doing legit moves in Pipedrive don't break.

import { PIPELINE_STAGES, type PipelineStage } from '@/lib/types'

// Rank used to compare two stages. CA sits between Underwriting (3) and
// Approved (4) at 3.5 because that's how it functions in the workflow —
// it's a portal-only refinement of Underwriting that's already eligible
// to move on to Approved.
const STAGE_RANK: Record<string, number> = {
  'New Application':        0,
  'Processing':             1,
  'Pre-Underwriting':       2,
  'Underwriting':           3,
  'Conditionally Approved': 3.5,
  'Approved':               4,
  'Closed':                 5,
}

/**
 * Returns the stage we should actually write to the portal given the
 * incoming Pipedrive value and the current portal value.
 *
 * Returns null when there's no usable input (both null/unknown) — callers
 * should treat that as "skip the field" so an undefined value doesn't
 * clobber the portal column.
 */
export function chooseEffectiveStage(
  portalStage: string | null | undefined,
  pipedriveStage: string | null | undefined,
): PipelineStage | null {
  const portal = (portalStage ?? null) as string | null
  const pd     = (pipedriveStage ?? null) as string | null

  // Pipedrive sent nothing — leave portal alone.
  if (!pd) return (portal && PIPELINE_STAGES.includes(portal as PipelineStage)) ? (portal as PipelineStage) : null

  // First sync — no portal value to defend.
  if (!portal) {
    return PIPELINE_STAGES.includes(pd as PipelineStage) ? (pd as PipelineStage) : null
  }

  // Existing CA preservation.
  if (portal === 'Conditionally Approved' && pd === 'Underwriting') {
    return 'Conditionally Approved'
  }

  // Forward-stage protection. If portal is ahead of Pipedrive, refuse
  // the downgrade. Unknown stages fall through to "trust Pipedrive".
  const portalRank = STAGE_RANK[portal]
  const pdRank     = STAGE_RANK[pd]
  if (portalRank !== undefined && pdRank !== undefined && portalRank > pdRank) {
    return portal as PipelineStage
  }

  // Default: trust Pipedrive.
  return PIPELINE_STAGES.includes(pd as PipelineStage) ? (pd as PipelineStage) : null
}
