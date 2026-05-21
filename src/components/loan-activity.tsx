import { CollapsibleCard } from '@/components/collapsible-card'
import { redactStaffNames } from '@/lib/redact-activity'

export interface LoanEvent {
  id: string
  loan_id: string
  event_type: string
  description: string
  created_at: string
}

interface Props {
  events: LoanEvent[]
  title?: string
  /** When true, strip internal-staff names from descriptions. Set on
   *  borrower + broker views; staff (admin/LO/LP/UW) leave it false to see
   *  full attribution. */
  hideStaffNames?: boolean
}

function eventIcon(type: string): string {
  switch (type) {
    case 'condition_added':    return '📋'
    case 'status_changed':     return '🔄'
    case 'document_uploaded':  return '📄'
    default:                   return '•'
  }
}

function formatDateTime(val: string): string {
  return new Date(val).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function LoanActivity({ events, title = 'Recent Activity', hideStaffNames = false }: Props) {
  return (
    <CollapsibleCard title={title}>
      {events.length === 0 ? (
        <p className="text-sm text-gray-500">No activity yet.</p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-3.5 top-2 bottom-2 w-px bg-gray-200" />
          <div className="space-y-4">
            {events.map(event => (
              <div key={event.id} className="flex items-start gap-3">
                <div className="relative z-10 w-7 h-7 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center shrink-0 text-sm">
                  {eventIcon(event.event_type)}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-sm text-gray-900">
                    {hideStaffNames ? redactStaffNames(event.description) : event.description}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(event.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}
