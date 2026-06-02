// Fan-out email notifier for downstream-sync failures.
//
// Used when /api/loans/status successfully writes the portal DB but fails
// to push the change to Pipedrive or Airtable. Admins get one email per
// failure so they can manually reconcile (or hit the manual sync button).
//
// Best-effort: catches and logs send errors. Never throws — the caller is
// in a post-success path and shouldn't get a 500 because an email failed.

import { sendEmail } from '@/lib/mailer'
import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

interface NotifyArgs {
  supabase: SupabaseAdmin
  loanId: string
  propertyAddress: string | null
  channel: 'pipedrive' | 'airtable'
  newStatus: 'active' | 'on_hold' | 'cancelled'
  error: string
}

export async function notifyAdminsOfSyncFailure({
  supabase,
  loanId,
  propertyAddress,
  channel,
  newStatus,
  error,
}: NotifyArgs): Promise<void> {
  try {
    const { data: admins } = await supabase
      .from('admin_users')
      .select('email')
      .not('email', 'is', null)

    const recipients = (admins ?? [])
      .map(a => a.email)
      .filter((e): e is string => !!e && e.trim().length > 0 && e.includes('@'))

    if (recipients.length === 0) {
      console.warn('notifyAdminsOfSyncFailure: no admin emails found')
      return
    }

    const channelLabel = channel === 'pipedrive' ? 'Pipedrive' : 'Airtable'
    const propertyLine = propertyAddress ?? '(no address on file)'
    const subject = `${channelLabel} sync failure: ${propertyLine}`

    const html = `
      <p>A portal status change for loan <code>${loanId}</code> was saved
      successfully, but pushing the new status to <strong>${channelLabel}</strong>
      failed.</p>
      <ul>
        <li><strong>Property:</strong> ${escapeHtml(propertyLine)}</li>
        <li><strong>New status:</strong> ${newStatus}</li>
        <li><strong>Channel:</strong> ${channelLabel}</li>
        <li><strong>Error:</strong> ${escapeHtml(error)}</li>
      </ul>
      <p>The portal database reflects the new status. ${channelLabel} is now
      out of sync. To reconcile, open the loan and use the manual sync
      button, or fix the underlying error and retry.</p>
    `

    await sendEmail({
      to: recipients,
      subject,
      html,
      skipIfNoRecipients: true,
    })
  } catch (err) {
    console.error('notifyAdminsOfSyncFailure failed:', err instanceof Error ? err.message : err)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
