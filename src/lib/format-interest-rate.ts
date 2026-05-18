/**
 * Format a stored interest rate for display.
 *
 * Pipedrive (and the JotForm intake) is inconsistent — some deals store the
 * rate as a fraction (0.0775) and others as a percent (7.75). Hard-money
 * rates are realistically 5%–15%, so any value < 1 is almost certainly a
 * fraction that needs * 100. Values >= 1 are treated as already-in-percent.
 *
 * Output format: 3 decimals (e.g. "7.750%") to match how the team reads rates.
 */
export function formatInterestRate(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  const pct = val < 1 ? val * 100 : val
  return `${pct.toFixed(3)}%`
}
