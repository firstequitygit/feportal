/**
 * Format a Postgres date or timestamp string as 'Mon D, YYYY' for display.
 *
 * Handles the timezone gotcha for date-only columns: a string like '2026-05-15'
 * parsed via `new Date(val)` is treated as UTC midnight, then shifted into
 * the local timezone — which renders as the previous day in negative offsets.
 * For YYYY-MM-DD, we construct the date using local components to avoid that.
 */
export function formatDate(val: string | null | undefined): string {
  if (!val) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }
  return new Date(val).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

/**
 * Format a timestamp as 'Mon D, h:mm AM/PM' (current year) or
 * 'Mon D, YYYY, h:mm AM/PM' (other years). Used for upload / response
 * stamps on condition cards.
 */
export function formatDateTime(val: string | null | undefined): string {
  if (!val) return '—'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric', minute: '2-digit',
  })
}
