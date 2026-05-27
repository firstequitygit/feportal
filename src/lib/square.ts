import { SquareClient, SquareEnvironment } from 'square'

/** Server-side Square client. Never import in a Client Component. */
export function squareClient() {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN not set')
  return new SquareClient({
    token,
    environment:
      process.env.SQUARE_ENVIRONMENT === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  })
}

export const SQUARE_LOCATION_ID = () => {
  const id = process.env.SQUARE_LOCATION_ID
  if (!id) throw new Error('SQUARE_LOCATION_ID not set')
  return id
}

/** $45 per borrower (primary + co-borrowers), structurally capped at 4. */
export function feeCentsForBorrowerCount(count: number): number {
  const n = Math.max(1, Math.min(4, count))
  return n * 4500
}
