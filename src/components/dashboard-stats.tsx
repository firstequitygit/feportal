import { Building2, TrendingUp, CheckCircle2, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface StatBlock {
  label: string
  value: string
  /** Sub-line: a small caption under the main value (e.g. "$4.2M total volume"). */
  sub?: string | null
  icon: React.ComponentType<{ className?: string }>
  /** Tailwind classes for the icon tile background. */
  iconBgClass: string
  /** Tailwind classes for the icon color. */
  iconColorClass: string
  /** Force the value into the danger color (used for the outstanding-conditions tile). */
  emphasizeDanger?: boolean
}

interface Props {
  pipelineCount: number
  pipelineVolume: number
  /** Number of loans currently on hold — surfaced as a label suffix on the
   *  Pipeline Loans tile so held deals stay visible without polluting the
   *  primary count. */
  onHoldCount: number
  /** Surfaced via spread for forward-compat; not rendered today. */
  onHoldVolume?: number
  /** Active pipeline volume EXCLUDING loans in the Closed stage. */
  closedCountTrailing12: number
  closedVolumeTrailing12: number
  /** Outstanding conditions across the staff member's active loans. */
  outstandingCount: number
  outstandingForYou: number
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000)     return `$${(val / 1_000).toFixed(0)}K`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

export function DashboardStats({
  pipelineCount,
  pipelineVolume,
  onHoldCount,
  closedCountTrailing12,
  closedVolumeTrailing12,
  outstandingCount,
  outstandingForYou,
}: Props) {
  const stats: StatBlock[] = [
    {
      label: onHoldCount > 0 ? `Pipeline Loans · ${onHoldCount} on hold` : 'Pipeline Loans',
      value: String(pipelineCount),
      sub: pipelineVolume > 0 ? `${formatCurrency(pipelineVolume)} total volume` : null,
      icon: Building2,
      iconBgClass: 'bg-primary/10',
      iconColorClass: 'text-primary',
    },
    {
      label: 'Pipeline Volume',
      value: formatCurrency(pipelineVolume),
      sub: pipelineCount > 0 ? `Across ${pipelineCount} active loan${pipelineCount === 1 ? '' : 's'}` : null,
      icon: TrendingUp,
      iconBgClass: 'bg-blue-50',
      iconColorClass: 'text-blue-500',
    },
    {
      label: 'Closed (Last 12 Months)',
      value: String(closedCountTrailing12),
      sub: closedVolumeTrailing12 > 0 ? `${formatCurrency(closedVolumeTrailing12)} funded` : null,
      icon: CheckCircle2,
      iconBgClass: 'bg-green-50',
      iconColorClass: 'text-green-600',
    },
    {
      label: 'Outstanding for You',
      value: String(outstandingForYou),
      sub: outstandingCount > outstandingForYou
        ? `${outstandingCount} total across your loans`
        : null,
      icon: AlertCircle,
      iconBgClass: 'bg-red-50',
      iconColorClass: 'text-red-500',
      emphasizeDanger: true,
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {stats.map(s => (
        <Card key={s.label}>
          <CardContent className="pt-6 pb-5">
            <div className="flex items-start gap-4">
              <div className={`w-11 h-11 rounded-xl ${s.iconBgClass} flex items-center justify-center shrink-0`}>
                <s.icon className={`w-5 h-5 ${s.iconColorClass}`} />
              </div>
              <div className="min-w-0">
                <p className={`text-2xl font-bold tabular-nums ${s.emphasizeDanger && parseInt(s.value, 10) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {s.value}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 leading-tight">{s.label}</p>
                {s.sub && (
                  <p className="text-xs text-gray-400 mt-1 leading-tight">{s.sub}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
