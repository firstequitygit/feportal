import { setViewMode } from '@/app/actions/set-view-mode'
import type { StaffContext } from '@/lib/types'

interface Props {
  context: StaffContext
}

const BASE_ROLE_LABEL: Record<string, string> = {
  loan_officer: 'LO view',
  loan_processor: 'Processor view',
  underwriter: 'UW view',
}

export function AdminViewToggle({ context }: Props) {
  if (!context.can_toggle) return null
  const baseLabel = context.staff_user.base_role
    ? BASE_ROLE_LABEL[context.staff_user.base_role]
    : 'Base view'
  const isAdmin = context.active_kind === 'admin'

  return (
    <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5 text-xs font-medium shadow-sm">
      <form action={setViewMode.bind(null, 'admin')}>
        <button
          type="submit"
          aria-pressed={isAdmin}
          className={
            'rounded-full px-3 py-1 transition-colors ' +
            (isAdmin
              ? 'bg-zinc-900 text-white'
              : 'text-zinc-600 hover:bg-zinc-100')
          }
        >
          Admin
        </button>
      </form>
      <form action={setViewMode.bind(null, 'base')}>
        <button
          type="submit"
          aria-pressed={!isAdmin}
          className={
            'rounded-full px-3 py-1 transition-colors ' +
            (!isAdmin
              ? 'bg-zinc-900 text-white'
              : 'text-zinc-600 hover:bg-zinc-100')
          }
        >
          {baseLabel}
        </button>
      </form>
    </div>
  )
}
