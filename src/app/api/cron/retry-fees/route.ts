import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { chargeApplicationFee } from '@/lib/square'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'

/** First 16 hex of sha256 - keeps Square idempotency keys under the 45-char cap. */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

// Called automatically by Vercel cron every 3 minutes.
// Also protected by CRON_SECRET so only Vercel can trigger it.
//
// Collects application fees that failed to charge at submission time. When a
// borrower submits, the app SAVES a Square card then charges it immediately.
// A just-created Square card is eventually consistent, so the immediate charge
// can throw a transient error and the row is left with fee_charged_at NULL,
// fee_charge_status='needs_review', and a saved square_card_id/customer_id.
// The saved card charges fine a minute later, so this cron sweeps those rows
// and collects the fee automatically.

// A row is charged with the SAME stable idempotency key the inline flow uses
// (charge:${id}:${square_card_id}). If the fee somehow already got charged,
// Square dedupes on that key so there is no double charge.

/** Cap per run so a single invocation stays well inside the function budget. */
const BATCH_LIMIT = 50

type PendingRow = {
  id: string
  square_customer_id: string | null
  square_card_id: string | null
  fee_amount_cents: number | null
  submitted_loan_id: string | null
}

const SELECT_COLS = 'id, square_customer_id, square_card_id, fee_amount_cents, submitted_loan_id'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()

    // Rows to collect:
    //   - fee_charge_status='needs_review' (immediate charge threw), OR
    //   - fee_charge_status='charging' AND updated_at older than 3 minutes
    //     (a request crashed mid-charge and left the claim stuck).
    // All must have fee_charged_at NULL and a saved card + fee amount. Two
    // queries keep the interval filter simple, then merge/dedupe by id.
    const staleCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString()

    const [needsReview, staleCharging] = await Promise.all([
      admin
        .from('loan_applications')
        .select(SELECT_COLS)
        .is('fee_charged_at', null)
        .not('square_card_id', 'is', null)
        .not('square_customer_id', 'is', null)
        .not('fee_amount_cents', 'is', null)
        .eq('fee_charge_status', 'needs_review')
        .limit(BATCH_LIMIT),
      admin
        .from('loan_applications')
        .select(SELECT_COLS)
        .is('fee_charged_at', null)
        .not('square_card_id', 'is', null)
        .not('square_customer_id', 'is', null)
        .not('fee_amount_cents', 'is', null)
        .eq('fee_charge_status', 'charging')
        .lt('updated_at', staleCutoff)
        .limit(BATCH_LIMIT),
    ])

    if (needsReview.error) throw new Error(`needs_review query: ${needsReview.error.message}`)
    if (staleCharging.error) throw new Error(`stale charging query: ${staleCharging.error.message}`)

    const byId = new Map<string, PendingRow>()
    for (const r of (needsReview.data ?? []) as PendingRow[]) byId.set(r.id, r)
    for (const r of (staleCharging.data ?? []) as PendingRow[]) byId.set(r.id, r)
    const rows = Array.from(byId.values()).slice(0, BATCH_LIMIT)

    let processed = 0
    let charged = 0
    let declined = 0
    let stillPending = 0

    for (const row of rows) {
      // Wrap each row so one failure never aborts the batch.
      try {
        if (!row.square_customer_id || !row.square_card_id || !row.fee_amount_cents) {
          stillPending++
          continue
        }

        // Atomic claim: flip to 'charging' only if still uncharged and in a
        // claimable state. A concurrent cron run cannot also win the claim, so
        // the charge below runs at most once per row per collection.
        const { data: claimed } = await admin
          .from('loan_applications')
          .update({ fee_charge_status: 'charging', updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .is('fee_charged_at', null)
          .in('fee_charge_status', ['needs_review', 'charging'])
          .select('id')
          .maybeSingle()
        if (!claimed) continue // another run claimed it first

        processed++

        const result = await chargeApplicationFee({
          squareCustomerId: row.square_customer_id,
          squareCardId: row.square_card_id,
          feeAmountCents: row.fee_amount_cents,
          idempotencyKey: `charge:${shortHash(`${row.id}:${row.square_card_id}`)}`,
          note: `Credit & Background Check - loan application ${row.id} (retry)`,
        })

        if (result.ok) {
          const { error: persistErr } = await admin
            .from('loan_applications')
            .update({ fee_charged_at: new Date().toISOString(), fee_charge_status: 'charged' })
            .eq('id', row.id)
          if (persistErr) {
            const paymentId = (result.payment as { id?: string } | null)?.id ?? 'unknown'
            console.error(
              `CRITICAL: charge SUCCEEDED but persist FAILED (cron retry-fees) app=${row.id} squarePaymentId=${paymentId}:`,
              persistErr.message,
            )
            await admin.from('loan_applications').update({ fee_charge_status: 'needs_review' }).eq('id', row.id)
            stillPending++
            continue
          }
          charged++
          // Best-effort audit event, only when the application became a loan.
          if (row.submitted_loan_id) {
            try {
              await admin.from('loan_events').insert({
                loan_id: row.submitted_loan_id,
                event_type: 'fee_charged',
                description: `Credit & Background Check fee charged: $${(row.fee_amount_cents / 100).toFixed(2)}`,
              })
            } catch (logErr) {
              console.error('Audit log failed (fee_charged, cron):', logErr instanceof Error ? logErr.message : logErr)
            }
          }
          continue
        }

        if (result.declined) {
          // Genuine decline - the same card will decline again. Staff/borrower follow-up.
          await admin.from('loan_applications').update({ fee_charge_status: 'declined' }).eq('id', row.id)
          declined++
          continue
        }

        // Hard/transient error - leave retryable for the next run.
        console.error(`Cron retry-fees hard error app=${row.id}:`, result.message)
        await admin.from('loan_applications').update({ fee_charge_status: 'needs_review' }).eq('id', row.id)
        stillPending++
      } catch (rowErr) {
        console.error(`Cron retry-fees row failed app=${row.id}:`, rowErr instanceof Error ? rowErr.message : rowErr)
        stillPending++
      }
    }

    console.log(
      `Cron retry-fees complete: processed=${processed} charged=${charged} declined=${declined} stillPending=${stillPending}`,
    )
    return NextResponse.json({ processed, charged, declined, stillPending })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Cron retry-fees error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
