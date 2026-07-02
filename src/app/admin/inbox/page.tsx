// Admin Inbox — the personal queue for admin-portal users. Shows
// conditions pinned to the caller BY NAME (assigned_to_staff_id on any
// of their LO/LP/UW identities) plus their unread @mentions. Role-wide
// work (every LP condition on your loans, etc) lives in the role
// portals; this page exists for Operations staff like Alexis Vega who
// work from the admin portal and get conditions assigned to them
// individually.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { InboxView, type InboxItem } from '@/components/inbox-view'
import { fetchMentionsForRole, type MentionInboxRow } from '@/lib/fetch-mentions'
import { MentionsCard } from '@/components/mentions-card'
import { resolveAdminIdentities, staffRoleIds, mentionIdents } from '@/lib/admin-inbox'

export default async function AdminInbox() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const ids = await resolveAdminIdentities(adminClient, user.id)
  if (!ids.admin) redirect('/login')

  const roleIds = staffRoleIds(ids)

  const { data: conditions } = roleIds.length > 0
    ? await adminClient
        .from('conditions')
        .select('id, loan_id, title, description, status, category, rejection_reason, created_at, updated_at')
        .in('assigned_to_staff_id', roleIds)
    : { data: [] }

  const loanIds = [...new Set((conditions ?? []).map(c => c.loan_id as string))]
  const { data: loans } = loanIds.length > 0
    ? await adminClient
        .from('loans')
        .select('id, property_address, pipeline_stage, loan_number, archived')
        .in('id', loanIds)
    : { data: [] }
  const loanMap = new Map(
    (loans ?? [])
      .filter(l => !l.archived && l.pipeline_stage !== 'Closed')
      .map(l => [l.id as string, l]),
  )

  const items: InboxItem[] = (conditions ?? [])
    .filter(c => loanMap.has(c.loan_id as string))
    .map(c => {
      const loan = loanMap.get(c.loan_id as string)
      return {
        id: c.id,
        loan_id: c.loan_id,
        title: c.title,
        description: c.description,
        status: c.status,
        category: c.category,
        rejection_reason: c.rejection_reason,
        created_at: c.created_at,
        updated_at: c.updated_at,
        loan_address: loan?.property_address ?? null,
        loan_stage: loan?.pipeline_stage ?? null,
        loan_number: loan?.loan_number ?? null,
      }
    })

  // Merge the caller's mention streams (admin + any linked role rows).
  const mentionLists = await Promise.all(
    mentionIdents(ids).map(i => fetchMentionsForRole(adminClient, i, { limit: 20 })),
  )
  const mentions: MentionInboxRow[] = mentionLists
    .flat()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 20)

  return (
    <PortalShell
      userName={ids.admin.full_name}
      userRole="Administrator"
      dashboardHref="/admin"
      variant="admin"
    >
      {mentions.length > 0 && (
        <div className="mb-6">
          <MentionsCard initial={mentions} linkPrefix="/admin" />
        </div>
      )}
      {/* InboxView renders its own "Inbox N" header with the count. */}
      <InboxView items={items} role="loan_processor" linkPrefix="/admin" loansHref="/admin" />
    </PortalShell>
  )
}
