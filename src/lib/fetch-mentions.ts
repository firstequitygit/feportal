// Server-side helpers for reading a user's mention stream.
//
// Called from inbox pages and from PortalShell (sidebar badge). The
// helper accepts the role identifier so the same code path works whether
// the caller is admin / LO / LP / UW.

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient

interface RoleIdent {
  kind: 'admin' | 'loan_officer' | 'loan_processor' | 'underwriter'
  id: string
}

export interface MentionInboxRow {
  id: string
  loan_id: string
  condition_id: string | null
  source_kind: 'staff_note' | 'condition_note' | 'condition_response'
  excerpt: string | null
  mentioned_by_name: string | null
  read_at: string | null
  created_at: string
  property_address: string | null
}

/**
 * Per-role identifier resolver. A handful of staff hold rows in BOTH
 * admin_users and a role table (Anthony Palmiotto etc) — those people
 * have TWO mention streams. Inbox pages key by the role they're
 * currently viewing, so we resolve a single identifier here.
 */
export async function resolveRoleIdent(
  adminClient: AdminClient,
  authUserId: string,
  kind: RoleIdent['kind'],
): Promise<RoleIdent | null> {
  const table =
    kind === 'admin'          ? 'admin_users' :
    kind === 'loan_officer'   ? 'loan_officers' :
    kind === 'loan_processor' ? 'loan_processors' :
                                 'underwriters'
  const { data } = await adminClient
    .from(table).select('id').eq('auth_user_id', authUserId).maybeSingle()
  return data ? { kind, id: data.id } : null
}

export async function fetchMentionsForRole(
  adminClient: AdminClient,
  ident: RoleIdent,
  opts: { limit?: number; includeRead?: boolean } = {},
): Promise<MentionInboxRow[]> {
  const { limit = 50, includeRead = false } = opts
  let q = adminClient
    .from('mentions')
    .select('id, loan_id, condition_id, source_kind, excerpt, mentioned_by_name, read_at, created_at, loans!loan_id(property_address)')
    .eq('mentioned_user_kind', ident.kind)
    .eq('mentioned_user_id', ident.id)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!includeRead) q = q.is('read_at', null)
  const { data } = await q
  return (data ?? []).map(r => {
    const loan = (r as unknown as { loans?: { property_address: string | null } | null }).loans ?? null
    return {
      id: r.id as string,
      loan_id: r.loan_id as string,
      condition_id: (r.condition_id as string | null) ?? null,
      source_kind: r.source_kind as MentionInboxRow['source_kind'],
      excerpt: (r.excerpt as string | null) ?? null,
      mentioned_by_name: (r.mentioned_by_name as string | null) ?? null,
      read_at: (r.read_at as string | null) ?? null,
      created_at: r.created_at as string,
      property_address: loan?.property_address ?? null,
    }
  })
}

/** Unread count for the sidebar badge. */
export async function countUnreadMentions(
  adminClient: AdminClient,
  ident: RoleIdent,
): Promise<number> {
  const { count } = await adminClient
    .from('mentions')
    .select('id', { count: 'exact', head: true })
    .eq('mentioned_user_kind', ident.kind)
    .eq('mentioned_user_id', ident.id)
    .is('read_at', null)
  return count ?? 0
}
