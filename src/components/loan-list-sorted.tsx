// src/components/loan-list-sorted.tsx
'use client'

import { useCallback, useMemo, useState } from 'react'
import { FileX, GripVertical } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent } from '@/components/ui/card'
import { type Loan, type OutstandingCounts, type PipelineStage, PIPELINE_STAGES } from '@/lib/types'
import { LoanCard } from '@/components/loans/loan-card'
import { GroupHeader } from '@/components/loans/group-header'
import { LoanListToolbar } from '@/components/loans/loan-list-toolbar'
import { useLoanListView, type SortDefaults } from '@/lib/loans/view-state'
import { DEFAULT_VIEW_STATE } from '@/lib/loans/view-state'
import { applyView, type ViewLoan } from '@/lib/loans/apply-view'
import { formatLoanName } from '@/lib/format-loan-name'
import { RoleActivityStamps, type RoleActivity } from '@/components/loans/role-activity-stamp'
import { useImpersonation } from '@/components/impersonation-provider'
import type { LatestStaffNotes } from '@/lib/fetch-closer-notes'
import type { CardOrderEntry } from '@/lib/loans/fetch-card-order'

const ZERO_COUNTS: OutstandingCounts = { you: 0, borrower: 0, team: 0, total: 0 }
const BOARD_STAGES = PIPELINE_STAGES.slice(0, 6) // exclude 'Closed'

/**
 * Apply a user's manual card pins over a default-sorted stage group.
 *
 * Absolute-slot model: un-pinned cards stay in default order; each
 * pinned card (whose pin.stage matches this group) splices into its
 * saved slot index. Pins are inserted in ascending slot order; a tie
 * on the same slot goes to the more recently dragged card. A loan
 * whose pin was made in a different stage is treated as un-pinned
 * (its pin reset when it changed stage).
 */
function applyManualOrder<L extends { id: string }>(
  loans: L[],
  stageKey: string,
  pins: Record<string, CardOrderEntry>,
): L[] {
  const pinned: Array<{ loan: L; position: number; updatedAt: number }> = []
  const unpinned: L[] = []
  for (const loan of loans) {
    const p = pins[loan.id]
    if (p && p.stage === stageKey) pinned.push({ loan, position: p.position, updatedAt: p.updatedAt })
    else unpinned.push(loan)
  }
  if (pinned.length === 0) return loans
  pinned.sort((a, b) => a.position - b.position || b.updatedAt - a.updatedAt)
  const result = unpinned.slice()
  for (const { loan, position } of pinned) {
    const idx = Math.max(0, Math.min(Math.round(position), result.length))
    result.splice(idx, 0, loan)
  }
  return result
}

export type LoanWithBorrower = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
  loan_officers?: { id: string; full_name: string | null } | null
  loan_processors?: { id: string; full_name: string | null } | null
  loan_details?: { cash_out_amount: number | null } | null
}

interface Props {
  /** All non-closed loans (active, on_hold, cancelled). */
  activeLoans: LoanWithBorrower[]
  closedLoans: LoanWithBorrower[]
  outstandingMap: Record<string, OutstandingCounts>
  lastUpdatedMap: Record<string, string>
  /** loan_id → most recent LP / UW / Closer note excerpts. */
  latestNotesByLoan?: Record<string, LatestStaffNotes>
  /** loan_id → last LP / UW activity timestamps. Enables the staleness
   *  stamps on cards and the lp_activity / uw_activity sorts. */
  roleActivityMap?: Record<string, RoleActivity>
  /** Page-level default sort (e.g. stalest-LP-first on the LP page).
   *  Users can still change the sort in the toolbar. */
  defaultSort?: SortDefaults
  /** loan_id → this user's saved manual slot for the stage-grouped list.
   *  Presence (even when empty) turns ON drag-to-reorder; undefined keeps
   *  it off (e.g. before the loan_card_order migration has run). */
  manualOrderMap?: Record<string, CardOrderEntry>
  linkPrefix: string
  /**
   * When true, hides Loan-officer filter / group dimensions in the toolbar.
   * Used by the LO role page where the dimension is degenerate.
   */
  hideLoanOfficerDimensions?: boolean
}

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val)
}

function formatStage(stage: string | null): string {
  if (!stage) return 'Unknown'
  return stage.split(' /')[0].trim()
}

function uniquePeople(
  loans: LoanWithBorrower[],
  picker: (l: LoanWithBorrower) => { id: string; name: string } | null,
) {
  const map = new Map<string, { id: string; name: string }>()
  for (const l of loans) {
    const p = picker(l)
    if (p && !map.has(p.id)) map.set(p.id, p)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function LoanListSorted({
  activeLoans,
  closedLoans,
  outstandingMap,
  lastUpdatedMap,
  latestNotesByLoan,
  roleActivityMap,
  defaultSort,
  manualOrderMap,
  linkPrefix,
  hideLoanOfficerDimensions = false,
}: Props) {
  // Memoized so the object identity is stable across renders — the
  // view-state hook keys its memos on it.
  const sortDefaults = useMemo(
    () => defaultSort,
    [defaultSort?.sort, defaultSort?.dir], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const { state, patch, patchFilters, clearFilters } = useLoanListView(sortDefaults)

  const allLoans = useMemo<LoanWithBorrower[]>(
    () => [...activeLoans, ...closedLoans],
    [activeLoans, closedLoans],
  )

  // Board drag-and-drop: optimistic per-loan stage overrides. Cleared when
  // the page refreshes after a successful PATCH /api/loans/stage. On failure
  // we delete the override and surface a transient inline error.
  const router = useRouter()
  const { isImpersonating } = useImpersonation()
  const [stageOverrides, setStageOverrides] = useState<Record<string, PipelineStage>>({})
  const [lastError, setLastError] = useState<{ loanId: string; stage: PipelineStage; message: string } | null>(null)

  const effectiveStage = useCallback(
    (loanId: string, serverStage: PipelineStage | null): PipelineStage | null =>
      stageOverrides[loanId] ?? serverStage,
    [stageOverrides],
  )

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const onDragEnd = useCallback(async (event: DragEndEvent) => {
    if (isImpersonating) return
    const { active, over } = event
    if (!over) return
    const loanId = String(active.id)
    const newStage = String(over.id) as PipelineStage
    const loan = allLoans.find(l => l.id === loanId)
    if (!loan) return
    const currentStage = stageOverrides[loanId] ?? loan.pipeline_stage
    if (currentStage === newStage) return

    setStageOverrides(prev => ({ ...prev, [loanId]: newStage }))
    setLastError(null)

    try {
      const res = await fetch('/api/loans/stage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, stage: newStage }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data?.success) throw new Error(data?.error ?? 'Could not change stage')
      router.refresh()
    } catch (err) {
      setStageOverrides(prev => {
        const next = { ...prev }
        delete next[loanId]
        return next
      })
      setLastError({ loanId, stage: newStage, message: (err as Error).message })
      window.setTimeout(() => setLastError(null), 4000)
    }
  }, [allLoans, isImpersonating, router, stageOverrides])

  // ---- Manual card ordering (list view, grouped by stage, default sort) ----
  // Optimistic overrides layered over the server's saved pins so a drag
  // shows instantly; a failed save reverts the override.
  const [pinOverrides, setPinOverrides] = useState<Record<string, CardOrderEntry>>({})
  const effectivePins = useMemo<Record<string, CardOrderEntry>>(
    () => ({ ...(manualOrderMap ?? {}), ...pinOverrides }),
    [manualOrderMap, pinOverrides],
  )

  // Manual order applies only on the default sort — an explicit sort the
  // user picks overrides the saved arrangement (it reappears on default).
  const sortIsDefault =
    state.sort === (defaultSort?.sort ?? DEFAULT_VIEW_STATE.sort) &&
    state.dir === (defaultSort?.dir ?? DEFAULT_VIEW_STATE.dir)

  const manualEnabled =
    manualOrderMap !== undefined &&
    !isImpersonating &&
    state.view === 'list' &&
    state.group === 'pipeline_stage' &&
    sortIsDefault

  const listSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const loanOfficers = useMemo(
    () =>
      uniquePeople(allLoans, l =>
        l.loan_officers && l.loan_officer_id
          ? { id: l.loan_officer_id, name: l.loan_officers.full_name ?? 'Unnamed' }
          : null,
      ),
    [allLoans],
  )
  const loanProcessors = useMemo(
    () =>
      uniquePeople(allLoans, l =>
        l.loan_processors && l.loan_processor_id
          ? { id: l.loan_processor_id, name: l.loan_processors.full_name ?? 'Unnamed' }
          : null,
      ),
    [allLoans],
  )
  const loanTypes = useMemo(
    () =>
      [...new Set(
        allLoans.map(l => l.loan_type).filter((t): t is NonNullable<typeof t> => !!t),
      )].sort(),
    [allLoans],
  )

  const groups = useMemo(
    () => applyView(allLoans as ViewLoan[], state, { lastUpdatedMap, roleActivityMap }) as ReturnType<typeof applyView<LoanWithBorrower>>,
    [allLoans, state, lastUpdatedMap, roleActivityMap],
  )

  // Groups as actually rendered: when manual ordering is active, each
  // stage group's cards are re-ordered by the user's pins; otherwise the
  // default-sorted groups pass through untouched.
  const renderGroups = useMemo(
    () =>
      manualEnabled
        ? groups.map(g => ({ ...g, loans: applyManualOrder(g.loans, g.key, effectivePins) }))
        : groups,
    [groups, manualEnabled, effectivePins],
  )

  // Drag-to-reorder within a stage group (list view). Pins ONLY the
  // dragged card to its dropped slot; other cards keep flowing in
  // default order. Cross-group drops are ignored (changing stage is the
  // board view's job).
  const onListReorder = useCallback(async (event: DragEndEvent) => {
    if (isImpersonating) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const group = renderGroups.find(g => g.loans.some(l => l.id === activeId))
    if (!group) return
    const ids = group.loans.map(l => l.id)
    const newIndex = ids.indexOf(overId)
    if (newIndex < 0) return // dropped outside this group → ignore
    if (ids.indexOf(activeId) === newIndex) return

    const stage = group.key
    setPinOverrides(prev => ({
      ...prev,
      [activeId]: { stage, position: newIndex, updatedAt: Date.now() },
    }))
    try {
      const res = await fetch('/api/loans/card-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId: activeId, stage, position: newIndex }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data?.success) throw new Error(data?.error ?? 'Could not save order')
    } catch {
      // Revert the optimistic move on failure.
      setPinOverrides(prev => {
        const next = { ...prev }
        delete next[activeId]
        return next
      })
    }
  }, [isImpersonating, renderGroups])

  // On Hold loans live in a separate bucket at the bottom of the list,
  // regardless of the current loan_status filter (default = ['active']).
  // Otherwise a held loan would silently disappear from the LO/LP/UW
  // dashboard and get forgotten. Default collapsed so it doesn't clutter.
  const onHoldLoans = useMemo(
    () => allLoans.filter(l => l.loan_status === 'on_hold'),
    [allLoans],
  )
  const [onHoldExpanded, setOnHoldExpanded] = useState(false)

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  const total = allLoans.length
  if (total === 0) {
    return (
      <Card className="border border-gray-200">
        <CardContent className="py-16 flex flex-col items-center gap-3">
          <FileX className="w-10 h-10 text-gray-300" />
          <div className="text-center">
            <p className="text-gray-600 font-medium">No loans assigned yet</p>
            <p className="text-gray-400 text-sm mt-1">Loans assigned to you will appear here.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const filteredTotal = groups.reduce((acc, g) => acc + g.loans.length, 0)

  return (
    <div className="space-y-5">
      <LoanListToolbar
        state={state}
        onSortChange={(sort, dir) => patch({ sort, dir })}
        onGroupChange={group => patch({ group })}
        onFiltersChange={partial => patchFilters(partial)}
        onClearFilters={clearFilters}
        onViewChange={view => patch({ view })}
        loanOfficers={loanOfficers}
        loanProcessors={loanProcessors}
        loanTypes={loanTypes}
        hideLoanOfficerDimensions={hideLoanOfficerDimensions}
      />

      {state.view === 'board' && (
        <BoardView
          loans={groups.flatMap(g => g.loans)}
          linkPrefix={linkPrefix}
          outstandingMap={outstandingMap}
          roleActivityMap={roleActivityMap}
          effectiveStage={effectiveStage}
          lastError={lastError}
          sensors={dndSensors}
          onDragEnd={onDragEnd}
          dragDisabled={isImpersonating}
        />
      )}

      {state.view === 'list' && (
        <>
          {filteredTotal === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-gray-500 text-sm">
                No loans match the current filters.
              </CardContent>
            </Card>
          )}

          {state.group === 'none' ? (
            <div className="space-y-2">
              {renderGroups[0]?.loans.map(loan => (
                <LoanCard
                  key={loan.id}
                  loan={loan}
                  outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                  linkPrefix={linkPrefix}
                  latestNotes={latestNotesByLoan?.[loan.id] ?? null}
                  roleActivity={roleActivityMap ? roleActivityMap[loan.id] ?? { lp: null, uw: null } : null}
                />
              ))}
            </div>
          ) : (() => {
            const sections = renderGroups.map(group => {
              const isCollapsed = collapsed.has(group.key)
              const groupAmount = group.loans.reduce((sum, l) => sum + (l.loan_amount ?? 0), 0)
              const ids = group.loans.map(l => l.id)
              const cards = group.loans.map(loan => {
                const cardProps = {
                  loan,
                  outstanding: outstandingMap[loan.id] ?? ZERO_COUNTS,
                  linkPrefix,
                  latestNotes: latestNotesByLoan?.[loan.id] ?? null,
                  roleActivity: roleActivityMap ? roleActivityMap[loan.id] ?? { lp: null, uw: null } : null,
                  // Grouped by stage → sticky stage header makes the
                  // per-card stage pill redundant.
                  hideStagePill: state.group === 'pipeline_stage',
                }
                return manualEnabled
                  ? <SortableLoanCard key={loan.id} {...cardProps} />
                  : <LoanCard key={loan.id} {...cardProps} />
              })
              return (
                <section key={group.key}>
                  <GroupHeader
                    label={group.label}
                    count={group.loans.length}
                    amount={groupAmount}
                    collapsed={isCollapsed}
                    onToggle={() => toggleGroup(group.key)}
                  />
                  {!isCollapsed && (
                    manualEnabled ? (
                      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                        <div className="space-y-1.5">{cards}</div>
                      </SortableContext>
                    ) : (
                      <div className="space-y-1.5">{cards}</div>
                    )
                  )}
                </section>
              )
            })
            return manualEnabled
              ? <DndContext sensors={listSensors} onDragEnd={onListReorder}>{sections}</DndContext>
              : <>{sections}</>
          })()}

          {/* On Hold bucket — always rendered at the bottom regardless of
              the current loan_status filter. Default collapsed. Held loans
              would otherwise disappear from the dashboard since the
              default filter is loan_status=['active']. */}
          {onHoldLoans.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setOnHoldExpanded(o => !o)}
                aria-expanded={onHoldExpanded}
                className="w-full flex items-center gap-3 mt-2 mb-2 group"
              >
                <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-widest whitespace-nowrap group-hover:text-amber-900 transition-colors">
                  {onHoldExpanded ? '▾' : '▸'} On Hold — {onHoldLoans.length}{' '}
                  <span className="text-amber-300">·</span>{' '}
                  <span className="tabular-nums tracking-normal">
                    {formatCompactCurrency(onHoldLoans.reduce((sum, l) => sum + (l.loan_amount ?? 0), 0))}
                  </span>
                </h3>
                <div className="flex-1 h-px bg-amber-200" />
                <span className="text-xs text-amber-700 group-hover:text-amber-900 transition-colors whitespace-nowrap">
                  {onHoldExpanded ? 'Hide' : 'Show'}
                </span>
              </button>
              {onHoldExpanded && (
                <div className="space-y-1.5">
                  {onHoldLoans.map(loan => (
                    <LoanCard
                      key={loan.id}
                      loan={loan}
                      outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                      linkPrefix={linkPrefix}
                      latestNotes={latestNotesByLoan?.[loan.id] ?? null}
                      roleActivity={roleActivityMap ? roleActivityMap[loan.id] ?? { lp: null, uw: null } : null}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function formatCompactCurrency(val: number | null): string {
  if (val === null) return '—'
  if (val === 0) return '$0'
  if (Math.abs(val) < 1000) return `$${Math.round(val)}`
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(val)
}

// Loan card with a drag handle for manual reordering. Only the grip
// carries the drag listeners, so the card itself stays a normal
// click-through link.
function SortableLoanCard(props: React.ComponentProps<typeof LoanCard>) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.loan.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative',
  }
  return (
    <div ref={setNodeRef} style={style} className={`flex items-stretch gap-1 ${isDragging ? 'opacity-90' : ''}`}>
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        type="button"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className="shrink-0 flex items-center px-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        <LoanCard {...props} />
      </div>
    </div>
  )
}

function boardAccentClass(loan: LoanWithBorrower, outstanding: OutstandingCounts): string {
  if (loan.loan_status === 'cancelled') return 'border-l-red-300'
  if (loan.loan_status === 'on_hold') return 'border-l-amber-400'
  if (loan.pipeline_stage === 'Closed') return 'border-l-gray-300'
  if (outstanding.you > 0) return 'border-l-red-400'
  if (outstanding.total > 0) return 'border-l-amber-300'
  return 'border-l-green-400'
}

function boardStatusChip(
  loan: LoanWithBorrower,
  outstanding: OutstandingCounts,
): { text: string; className: string } | null {
  if (loan.loan_status === 'cancelled') return { text: 'Cancelled', className: 'bg-red-100 text-red-700' }
  if (loan.loan_status === 'on_hold') return { text: 'On Hold', className: 'bg-amber-100 text-amber-800' }
  if (outstanding.you > 0) return { text: `You ${outstanding.you}`, className: 'bg-red-100 text-red-700' }
  if (outstanding.borrower > 0) return { text: `Borrower ${outstanding.borrower}`, className: 'bg-amber-100 text-amber-700' }
  if (outstanding.team > 0) return { text: `Team ${outstanding.team}`, className: 'bg-gray-100 text-gray-600' }
  return null
}

function BoardDroppableColumn({
  stage,
  errorMessage,
  children,
}: {
  stage: PipelineStage
  errorMessage: string | null
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <div
      ref={setNodeRef}
      className={`w-48 shrink-0 snap-start rounded-md transition-colors ${
        isOver ? 'bg-blue-50 ring-1 ring-blue-200' : ''
      }`}
    >
      {children}
      {errorMessage && (
        <p className="mt-1 px-1 text-[10px] text-red-600 truncate" title={errorMessage}>
          {errorMessage}
        </p>
      )}
    </div>
  )
}

function BoardDraggableCard({
  loan,
  outstanding,
  linkPrefix,
  roleActivity,
  errored,
  disabled,
}: {
  loan: LoanWithBorrower
  outstanding: OutstandingCounts
  linkPrefix: string
  roleActivity?: RoleActivity
  errored: boolean
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: loan.id,
    disabled,
  })

  const accent = boardAccentClass(loan, outstanding)
  const chip = boardStatusChip(loan, outstanding)
  const isDimmed = loan.loan_status === 'cancelled' || loan.pipeline_stage === 'Closed'

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : {}

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Link
        href={`${linkPrefix}/loans/${loan.id}`}
        onClick={e => { if (isDragging) e.preventDefault() }}
        className={`block rounded-md border border-gray-200 border-l-4 ${accent} bg-white px-2 py-1.5 transition-all duration-150 hover:shadow-sm hover:border-gray-300 ${
          isDimmed ? 'opacity-70' : ''
        } ${loan.loan_status === 'on_hold' ? 'bg-amber-50/40' : ''} ${
          isDragging ? 'scale-[1.02] shadow-lg cursor-grabbing' : disabled ? 'cursor-default' : 'cursor-grab'
        } ${errored ? 'ring-2 ring-red-400' : ''}`}
      >
        <div className="flex items-baseline justify-between gap-1.5">
          <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate min-w-0 flex-1">
            {formatLoanName({
              borrowerName: loan.borrowers?.full_name,
              propertyAddress: loan.property_address,
              loanNumber: loan.loan_number,
            })}
          </p>
          <p className="text-[11px] font-semibold text-gray-900 whitespace-nowrap">
            {formatCompactCurrency(loan.loan_amount)}
          </p>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <p className="text-[10px] text-gray-500 truncate min-w-0 flex-1">
            {loan.loan_type ?? '—'}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            {roleActivity && <RoleActivityStamps activity={roleActivity} />}
            {chip && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${chip.className}`}>
                {chip.text}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}

function BoardView({
  loans,
  linkPrefix,
  outstandingMap,
  roleActivityMap,
  effectiveStage,
  lastError,
  sensors,
  onDragEnd,
  dragDisabled,
}: {
  loans: LoanWithBorrower[]
  linkPrefix: string
  outstandingMap: Record<string, OutstandingCounts>
  roleActivityMap?: Record<string, RoleActivity>
  effectiveStage: (loanId: string, serverStage: PipelineStage | null) => PipelineStage | null
  lastError: { loanId: string; stage: PipelineStage; message: string } | null
  sensors: ReturnType<typeof useSensors>
  onDragEnd: (event: DragEndEvent) => void
  dragDisabled: boolean
}) {
  const columns = BOARD_STAGES.map(stage => {
    const stageLoans = loans.filter(l => effectiveStage(l.id, l.pipeline_stage) === stage)
    const total = stageLoans.reduce((sum, l) => sum + (l.loan_amount ?? 0), 0)
    return { stage, loans: stageLoans, total }
  })

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="pb-4">
        <div className="flex gap-2 overflow-x-auto pb-2 snap-x -mx-2 px-2">
          {columns.map(({ stage, loans: stageLoans, total }) => (
            <BoardDroppableColumn
              key={stage}
              stage={stage}
              errorMessage={lastError && lastError.stage === stage ? lastError.message : null}
            >
              <div className="flex items-center justify-between mb-1.5 px-1 gap-2">
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">
                  {formatStage(stage)}
                </h3>
                <span className="text-[10px] text-gray-500 shrink-0 whitespace-nowrap">
                  {stageLoans.length}{total > 0 ? ` · ${formatCompactCurrency(total)}` : ''}
                </span>
              </div>
              <div className="space-y-1">
                {stageLoans.map(loan => (
                  <BoardDraggableCard
                    key={loan.id}
                    loan={loan}
                    outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                    linkPrefix={linkPrefix}
                    roleActivity={roleActivityMap ? roleActivityMap[loan.id] ?? { lp: null, uw: null } : undefined}
                    errored={lastError?.loanId === loan.id}
                    disabled={dragDisabled}
                  />
                ))}
                {stageLoans.length === 0 && (
                  <div className="border border-dashed border-gray-200 rounded-md h-10 flex items-center justify-center">
                    <p className="text-[10px] text-gray-400">Empty</p>
                  </div>
                )}
              </div>
            </BoardDroppableColumn>
          ))}
        </div>
      </div>
    </DndContext>
  )
}
