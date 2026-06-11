// Compact "LP 3d · UW 8d" staleness stamps for loan cards. Shows how
// long since the LP / UW last touched the file (from loan_events
// tagged with actor_role).
//
// Staleness color thresholds (per Adam, June 2026):
//   < 2 days   → neutral gray
//   ≥ 2 days   → amber
//   ≥ 4 days   → red
//   ≥ 7 days   → filled red badge (the "drastic" tier)
// Never touched → "—" in neutral gray (sorts to the top regardless).

const DAY_MS = 86_400_000

export interface RoleActivity {
  lp: string | null
  uw: string | null
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 3_600_000) return `${Math.max(1, Math.floor(ms / 60_000))}m`
  if (ms < DAY_MS) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / DAY_MS)}d`
}

function stampClasses(iso: string | null): string {
  if (!iso) return 'text-gray-400'
  const days = (Date.now() - new Date(iso).getTime()) / DAY_MS
  if (days >= 7) return 'bg-red-600 text-white px-1.5 rounded-full font-semibold'
  if (days >= 4) return 'text-red-600 font-semibold'
  if (days >= 2) return 'text-amber-600 font-medium'
  return 'text-gray-500'
}

function Stamp({ label, iso }: { label: string; iso: string | null }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-gray-400">{label} </span>
      <span className={stampClasses(iso)}>{iso ? ageLabel(iso) : '—'}</span>
    </span>
  )
}

/** Inline pair of stamps — caller controls the wrapping layout. */
export function RoleActivityStamps({ activity }: { activity: RoleActivity }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px]">
      <Stamp label="LP" iso={activity.lp} />
      <Stamp label="UW" iso={activity.uw} />
    </span>
  )
}
