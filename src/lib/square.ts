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

export type ChargeResult =
  | { ok: true; payment: unknown }
  | { ok: false; declined: true; message: string }
  | { ok: false; declined: false; message: string }

/**
 * Charge a saved Square card for the application fee.
 *
 * Returns a discriminated result so callers can distinguish:
 *   ok:true         - COMPLETED or APPROVED; money collected
 *   ok:false, declined:true  - Square payment/card error (4xx); user should retry with another card
 *   ok:false, declined:false - Network or unexpected error; retryable on the caller's side
 *
 * Note on decline detection: Square v44 throws an ApiError (with an `errors` array) for card
 * declines and other payment rejections. We treat any ApiError as a decline because Square
 * does not surface a distinct network-error type in this SDK version -- genuine network failures
 * surface as plain Error instances. This heuristic is correct for the common cases.
 */
export async function chargeApplicationFee({
  squareCustomerId,
  squareCardId,
  feeAmountCents,
  idempotencyKey,
  note,
}: {
  squareCustomerId: string
  squareCardId: string
  feeAmountCents: number
  idempotencyKey: string
  note: string
}): Promise<ChargeResult> {
  try {
    const sq = squareClient()
    // Square v44: payments.create() returns HttpResponsePromise<CreatePaymentResponse>.
    // Awaiting unwraps directly to CreatePaymentResponse; amountMoney.amount must be BigInt.
    const pay = await sq.payments.create({
      idempotencyKey,
      sourceId: squareCardId,
      customerId: squareCustomerId,
      locationId: SQUARE_LOCATION_ID(),
      amountMoney: { amount: BigInt(feeAmountCents), currency: 'USD' },
      note,
    })
    const status = pay.payment?.status
    if (status !== 'COMPLETED' && status !== 'APPROVED') {
      return { ok: false, declined: true, message: `Square status ${status ?? 'unknown'}` }
    }
    return { ok: true, payment: pay.payment }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Square ApiError has an `errors` array; treat as a card/payment decline.
    // Plain Error without that shape is a network or config failure (retryable).
    const isSquareApiError =
      e != null && typeof e === 'object' && 'errors' in e && Array.isArray((e as { errors: unknown }).errors)
    if (isSquareApiError) {
      return { ok: false, declined: true, message }
    }
    return { ok: false, declined: false, message }
  }
}
