export function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val)
}

/**
 * Compact currency for tight UI surfaces. Examples:
 *   0          -> "$0"
 *   1,500      -> "$1.5K"
 *   260,480    -> "$260K"
 *   2,501,750  -> "$2.5M"
 */
export function formatCompactCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '-'
  if (val === 0) return '$0'
  const abs = Math.abs(val)
  if (abs < 1000) return `$${Math.round(val)}`
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(val)
}
