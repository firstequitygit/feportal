import Link from 'next/link'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent } from '@/components/ui/card'
import { getReportContext, roleLabel } from '@/lib/reports/auth'
import { BarChart3, Briefcase, Clock, ClipboardList, CalendarRange } from 'lucide-react'

const REPORTS = [
  {
    href: '/reports/pipeline',
    label: 'Pipeline by Stage',
    description: 'Active loans grouped by stage. Snapshot of where everything sits today.',
    icon: BarChart3,
  },
  {
    href: '/reports/production',
    label: 'Production by Loan Officer',
    description: 'Closed loans per LO over a selected date range — count, total volume, average size.',
    icon: Briefcase,
  },
  {
    href: '/reports/aging',
    label: 'Aging / Stuck Loans',
    description: 'Active loans sitting in the same stage longer than a chosen threshold.',
    icon: Clock,
  },
  {
    href: '/reports/conditions',
    label: 'Outstanding Conditions',
    description: 'Open and rejected conditions across all active loans, by assignee.',
    icon: ClipboardList,
  },
  {
    href: '/reports/closings',
    label: 'Closings by Month',
    description: 'Closed loans bucketed by month for the trailing 12 months — count and volume.',
    icon: CalendarRange,
  },
]

export default async function ReportsLandingPage() {
  const ctx = await getReportContext()

  return (
    <PortalShell
      userName={ctx.userName}
      userRole={roleLabel(ctx.role)}
      dashboardHref={ctx.dashboardHref}
      variant={ctx.shellVariant}
    >
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
        <p className="text-sm text-gray-500 mt-1">
          {ctx.role === 'admin'
            ? 'Pipeline, production, and condition snapshots across the entire portfolio.'
            : 'Pipeline, production, and condition snapshots — scoped to loans assigned to you.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="hover:border-primary/40 transition-colors cursor-pointer">
              <CardContent className="p-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">{label}</h3>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </PortalShell>
  )
}
