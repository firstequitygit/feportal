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
 * Square error codes that represent a genuine card/account decline. These will
 * NOT be retried: the same saved card will decline again, so we surface the
 * decline to the borrower immediately.
 */
const DECLINE_CODES = new Set([
  'CARD_DECLINED',
  'GENERIC_DECLINE',
  'INSUFFICIENT_FUNDS',
  'CVV_FAILURE',
  'CARD_EXPIRED',
  'ADDRESS_VERIFICATION_FAILURE',
  'INVALID_ACCOUNT',
  'CARD_NOT_SUPPORTED',
  'INVALID_EXPIRATION',
  'CARD_DECLINED_VERIFICATION_REQUIRED',
  'CARD_DECLINED_CALL_ISSUER',
  'ALLOWABLE_PIN_TRIES_EXCEEDED',
])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Backoff between charge attempts (ms). Length also caps the retry count. */
const RETRY_BACKOFF_MS = [800, 1600]

/** Square ApiError carries an `errors` array of { category, code, detail }. */
type SquareApiErrorItem = { category?: string; code?: string; detail?: string }

/** Extract the Square error items from a thrown value, if present. */
function squareErrorItems(e: unknown): SquareApiErrorItem[] {
  if (e != null && typeof e === 'object' && 'errors' in e) {
    const errs = (e as { errors: unknown }).errors
    if (Array.isArray(errs)) return errs as SquareApiErrorItem[]
  }
  return []
}

/**
 * Charge a saved Square card for the application fee.
 *
 * Returns a discriminated result so callers can distinguish:
 *   ok:true         - COMPLETED or APPROVED; money collected
 *   ok:false, declined:true  - Genuine card/account decline; user should retry with another card
 *   ok:false, declined:false - Transient/system/network error; caller routes to needs_review
 *
 * Retry rationale: Square's just-created card-on-file is eventually consistent, so the first
 * payments.create() can THROW a transient error (e.g. NOT_FOUND) for a perfectly good card.
 * We retry transient/system errors with backoff, reusing the SAME idempotencyKey on every
 * attempt so retries are double-charge-safe: Square dedupes on the key, a transient throw
 * created no payment (key reusable), and a genuine decline returns the cached result.
 * Only genuine decline codes (DECLINE_CODES) short-circuit without retrying.
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
  const sq = squareClient()
  const maxAttempts = RETRY_BACKOFF_MS.length + 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
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
        // Returned (no throw) with a non-success status (e.g. PENDING). This is AMBIGUOUS:
        // the payment may still settle, so it must NOT be treated as a retryable decline. A
        // client re-submit re-tokenizes into a new card id -> new idempotency key, which would
        // double-charge if this attempt actually settled. Route to needs_review instead.
        return { ok: false, declined: false, message: `Square status ${status ?? 'unknown'}` }
      }
      return { ok: true, payment: pay.payment }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const items = squareErrorItems(e)
      // Check every returned error item (not just the first) for a genuine decline code.
      const isDecline = items.some((i) => i.code != null && DECLINE_CODES.has(i.code))
      // Log the failure path loudly: previously we logged nothing here, which made this
      // transient-failure bug invisible in production.
      console.error(
        `chargeApplicationFee attempt ${attempt}/${maxAttempts} failed:`,
        items.length > 0
          ? items.map((i) => `[${i.category ?? '?'}/${i.code ?? '?'}] ${i.detail ?? message}`).join('; ')
          : message,
      )

      if (isDecline) {
        // Genuine decline - the same card will decline again; do not retry.
        return { ok: false, declined: true, message }
      }

      // Transient/system/unknown (NOT_FOUND, INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE,
      // RATE_LIMITED, GATEWAY_TIMEOUT, or a codeless network error). Retry if attempts remain.
      if (attempt < maxAttempts) {
        await sleep(RETRY_BACKOFF_MS[attempt - 1])
        continue
      }
      // Out of attempts - hard error. Caller routes this to needs_review, not a borrower decline.
      return { ok: false, declined: false, message }
    }
  }

  // Unreachable: the loop always returns. Satisfies the type checker.
  return { ok: false, declined: false, message: 'charge exhausted retries' }
}
