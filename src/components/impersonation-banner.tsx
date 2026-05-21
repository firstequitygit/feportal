import Link from 'next/link'
import { Eye, X } from 'lucide-react'

interface Props {
  kind: 'borrower' | 'broker' | 'loan_officer' | 'loan_processor' | 'underwriter'
  name?: string | null
  /** Where the "Exit" link sends the admin back to. */
  exitHref: string
}

/**
 * Yellow banner that sits above the page content when an admin is viewing
 * the portal as another user via `?as_borrower=` / `?as_broker=`.  Keeps the
 * admin oriented and gives a one-click escape hatch.  Server component —
 * renders inline.
 */
export function ImpersonationBanner({ kind, name, exitHref }: Props) {
  const label =
    kind === 'borrower'       ? 'Borrower'       :
    kind === 'broker'         ? 'Broker'         :
    kind === 'loan_officer'   ? 'Loan Officer'   :
    kind === 'loan_processor' ? 'Loan Processor' :
    'Underwriter'
  return (
    <div className="bg-amber-100 border-b border-amber-300 text-amber-900">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4" />
          <span>
            Admin preview — viewing as <strong>{label}{name ? ` · ${name}` : ''}</strong>
          </span>
        </div>
        <Link
          href={exitHref}
          className="flex items-center gap-1 text-amber-900 hover:text-amber-700 font-medium"
        >
          <X className="w-3.5 h-3.5" />
          Exit preview
        </Link>
      </div>
    </div>
  )
}
