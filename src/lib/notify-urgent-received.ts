// Sends the "urgent condition received" email to the loan's underwriter.
//
// Called from every code path that can flip a condition's status into
// 'Received': admin PATCH, LO/LP "responded" PUTs, borrower text response,
// one-click action token. Centralized here so adding a new status-change
// path can't accidentally skip the notification.
//
// Behavior:
//  - No-op when the condition isn't urgent.
//  - No-op when the status didn't transition INTO 'Received' (e.g. the
//    new status is something else, or it was already Received).
//  - No-op when the loan has no underwriter assigned.
//  - Failures are logged but never thrown — the caller has already
//    persisted the status change, and the email is a side effect.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/mailer'
import { PORTAL_URL } from '@/lib/portal-url'

type AdminClient = SupabaseClient

interface Params {
  adminClient: AdminClient
  conditionId: string
  /** Status the row holds AFTER the update has been applied. */
  newStatus: string
  /** Status the row held BEFORE the update — used to detect a transition. */
  previousStatus: string | null
}

export async function notifyUwIfUrgentReceived({
  adminClient,
  conditionId,
  newStatus,
  previousStatus,
}: Params): Promise<void> {
  if (newStatus !== 'Received') return
  if (previousStatus === 'Received') return  // already there — no transition

  try {
    const { data: row } = await adminClient
      .from('conditions')
      .select('id, title, description, is_urgent, loan_id, loans!loan_id(property_address, underwriters!underwriter_id(full_name, email))')
      .eq('id', conditionId)
      .single()

    if (!row || !row.is_urgent) return

    const loan = (row as unknown as {
      loans?: {
        property_address: string | null
        underwriters?: { full_name: string | null; email: string | null } | null
      } | null
    }).loans ?? null

    const uw = loan?.underwriters ?? null
    if (!uw?.email) return  // no UW assigned — silently skip

    const propertyAddress = loan?.property_address ?? 'a loan'
    const title = (row.title as string) ?? '(untitled condition)'
    const description = (row.description as string | null) ?? null

    await sendEmail({
      to: uw.email,
      subject: `URGENT condition received — ${propertyAddress}`,
      html: `
        <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${uw.full_name ?? 'there'},</p>
        <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
          An <strong style="color: #b91c1c;">urgent</strong> condition on <strong>${propertyAddress}</strong> has just been marked Received and is ready for your review.
        </p>
        <table style="font-family: Arial, sans-serif; font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
          <tr><td style="padding: 4px 16px 4px 0; color: #666;">Condition</td><td><strong>${title}</strong></td></tr>
          ${description ? `<tr><td style="padding: 4px 16px 4px 0; color: #666;">Details</td><td>${description}</td></tr>` : ''}
        </table>
        <p style="margin-top: 16px;">
          <a href="${PORTAL_URL}/underwriter" style="background-color: #b91c1c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">Review now</a>
        </p>
        <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
      `,
    })
  } catch (err) {
    console.error('Notification error (urgent condition received):', err)
  }
}
