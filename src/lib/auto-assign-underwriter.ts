// Auto-assigns the default underwriter (Alicyn DeSimone) to a loan when it
// transitions into Pre-Underwriting. Replaces the team-wide claim blast
// for loans without a prior UW — those loans now arrive in Alicyn's queue
// directly.
//
// Skip conditions (no-op + return false):
//   - Loan already has underwriter_id set (don't clobber a manual pick)
//   - Default UW row not found (name typo / staff turnover) — caller can
//     fall back to the team blast
//
// Called from /api/loans/stage, /api/sync, /api/webhooks/pipedrive. Cron
// sync does not call this (cron is the silent backfill path, matches the
// existing email-trigger policy).

import type { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/mailer'
import { PORTAL_URL, PORTAL_DOMAIN } from '@/lib/portal-url'

type AdminClient = ReturnType<typeof createAdminClient>

// Lookup by full_name — change here if the default UW changes. Could also
// graduate to an `is_default_underwriter` boolean on the underwriters
// table if multiple defaults or rotation logic is needed later.
const DEFAULT_UNDERWRITER_NAME = 'Alicyn DeSimone'

export async function autoAssignDefaultUnderwriter(
  adminClient: AdminClient,
  loanId: string,
): Promise<{ assigned: boolean; reason?: string }> {
  // Don't override an existing assignment.
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, underwriter_id, property_address, loan_number, loan_amount, loan_type')
    .eq('id', loanId)
    .single()
  if (!loan) return { assigned: false, reason: 'loan not found' }
  if (loan.underwriter_id) return { assigned: false, reason: 'already assigned' }

  const { data: uw } = await adminClient
    .from('underwriters')
    .select('id, full_name, email')
    .ilike('full_name', DEFAULT_UNDERWRITER_NAME)
    .maybeSingle()
  if (!uw) return { assigned: false, reason: 'default underwriter not found' }

  const { error } = await adminClient
    .from('loans').update({ underwriter_id: uw.id }).eq('id', loanId)
  if (error) {
    console.error('Auto-assign UW update failed:', error.message)
    return { assigned: false, reason: error.message }
  }

  // Audit log — same format as manual underwriter assignment events.
  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'underwriter_assigned',
      description: `${uw.full_name} auto-assigned as Underwriter on Pre-Underwriting transition`,
    })
  } catch (err) { console.error('Auto-assign UW event log error:', err) }

  // Email the UW. Best-effort — assignment is the durable state, email is
  // a courtesy notification.
  if (uw.email) {
    try {
      const property = loan.property_address ?? 'a new loan'
      const detailRows = [
        loan.loan_number ? ['Loan #', loan.loan_number] : null,
        loan.loan_type ? ['Type', loan.loan_type] : null,
        loan.loan_amount
          ? ['Amount', new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(loan.loan_amount)]
          : null,
      ].filter((r): r is [string, string] => !!r)
      await sendEmail({
        to: uw.email,
        subject: `New loan assigned to you for underwriting — ${property}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
            <div style="background-color: #1F5D8F; padding: 20px 28px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: white; font-size: 18px;">Loan Assigned for Underwriting</h1>
            </div>
            <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="font-size: 15px; margin-top: 0;">Hi ${uw.full_name?.split(/\s+/)[0] ?? 'there'},</p>
              <p style="font-size: 15px;">
                A loan has moved into <strong style="color: #1F5D8F;">Pre-Underwriting</strong> and
                has been assigned to you.
              </p>
              <table style="font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
                <tr><td style="padding: 4px 16px 4px 0; color: #666;">Property</td><td><strong>${property}</strong></td></tr>
                ${detailRows.map(([k, v]) => `<tr><td style="padding: 4px 16px 4px 0; color: #666;">${k}</td><td><strong>${v}</strong></td></tr>`).join('')}
              </table>
              <p style="margin-top: 24px;">
                <a href="${PORTAL_URL}/underwriter/loans/${loanId}"
                   style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">
                  Open Loan
                </a>
              </p>
              <p style="font-size: 13px; color: #555; margin-top: 24px;">— The First Equity Funding Team</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
              <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
            </div>
          </div>
        `,
      })
    } catch (err) {
      console.error(`Auto-assign UW email to ${uw.email} failed:`, err)
    }
  }

  return { assigned: true }
}
