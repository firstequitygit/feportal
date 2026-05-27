# Admin Settings Hub - Design (v1: read-only visibility)

**Date:** 2026-05-22
**Branch:** `feature/admin-settings` (off `main`; merged after manual testing)
**Status:** Approved; amended 2026-05-26 to match the actual state of `main`

## 0. Amendment (2026-05-26)

After approval, inspection of `main` showed commit `daceef0` ("Admin: Settings hub
for user management + sidebar header fix") already shipped a Settings hub that this
spec assumed didn't exist:

- `/admin/settings` route exists with `layout.tsx` rendering `PortalShell` + a
  client-side `SettingsSidebar` (`src/components/settings-sidebar.tsx`).
- Sub-pages exist at `/admin/settings/users/{loan-officers, loan-processors,
  underwriters, admins}`; the old top-level `/admin/loan-officers` etc. pages were
  consolidated here.
- The hub is **admin-only**; only the "Admins" sub-item is super-admin-gated
  (`isSuperAdmin ? [...USERS_SUBITEMS, ADMINS_SUBITEM] : USERS_SUBITEMS`).
- `ADMIN_NAV` in `portal-shell.tsx` already contains the top-level `/admin/settings`
  entry.

**Reconciliation:**
- Drop the "create the page + add the top-level nav item" work. Add **two sub-pages
  under the existing hub** instead: `/admin/settings/session` and
  `/admin/settings/permissions`, and a new "System" group in `SettingsSidebar`
  containing both.
- **Gating override:** Section 2 said super-admin-only. The two new sub-pages are
  **admin-only** to match the existing hub's posture, since v1 is read-only
  (decided 2026-05-26).
- All other content (Section 3 module extractions, Section 5 matrix, Section 6
  verification, Section 7 deferrals) stands unchanged.

---

## 1. Summary & intent

Add a **Settings** section to the admin sidebar. It opens a hub page that surfaces
configuration that is currently *hidden in code* so admins can see what the portal
actually does today:

- **Session policy** - the idle-logout timeout (2 hours) and absolute session cap
  (12 hours).
- **Roles & Permissions** - a faithful, read-only matrix of what each of the five
  roles can do.

**v1 is visibility-only.** No database changes, no `proxy.ts` behavior change, no
authorization/enforcement changes. We expose the values and rules that already
govern the app. Making them editable is explicitly a later phase (Section 7).

This scope was chosen deliberately by the user: "just going to visually see the idle
timeout and roles/permissions for now since they were previously hidden. No major
changes yet to the actual way things work."

## 2. Decisions locked in

| Decision | Choice |
|---|---|
| Permission model (long term) | Capability toggles layered on the existing 5 role tables (not a generic RBAC rewrite) |
| Who can open Settings | Super-admins only (`admin_users.is_super`), consistent with the existing `/admin/admins` page |
| Idle timeout scope (long term) | Single global value for all staff |
| Deactivation behavior (long term) | Immediate - revoke live sessions, not just block next login |
| Capability enforcement (long term) | Central helper + high-value chokepoints, not a blanket rewrite |
| **v1 build** | **Read-only display of current idle timeout + current roles/permissions. Nothing editable.** |

The long-term choices shape how v1 code is structured (so later phases slot in
cleanly) but are **not implemented** in v1.

## 3. Architecture - the only real code change in v1

The two things we display are currently implicit:

- Timeout values are magic numbers in `src/proxy.ts` (`IDLE_LIMIT_MS = 2h`,
  `ABSOLUTE_LIMIT_MS = 12h`).
- The permission model is implicit: role = which table a user's `auth_user_id` is in,
  plus the `is_super` flag, plus the per-role nav arrays and per-route guards.

To display these honestly **without drift**, extract them into read-only config
modules that both the existing code and the new Settings page import. This is the
seam later phases make editable.

### 3a. `src/lib/session-config.ts` (new)

```ts
// Single source of truth for session timing. v1: constants only.
// Later phase: these become defaults backed by an editable app_settings row.
export const IDLE_TIMEOUT_MINUTES = 120     // log out after 2h idle
export const ABSOLUTE_CAP_MINUTES = 720     // hard cap at 12h regardless of activity
```

`src/proxy.ts` imports these instead of its inline constants. Behavior is identical -
the same numbers, centralized. This is the only change to the auth/session hot path
in v1.

### 3b. `src/lib/permissions/catalog.ts` (new)

A declarative description of the **current** model - data, not new rules. It mirrors
what the guards in the codebase already enforce (see Section 5, which is
reverse-engineered from the actual route/page guards). Shape:

```ts
export type RoleKey =
  | 'admin' | 'loan_officer' | 'loan_processor' | 'underwriter' | 'borrower'

// 'yes'      = full / unscoped
// 'assigned' = scoped to the user's own loans (rendered "assigned" for staff,
//              "own loans" for borrowers - same underlying meaning)
// 'super'    = admin super-tier only ('admin_users.is_super')
// 'no'       = not allowed
export type Access = 'yes' | 'assigned' | 'super' | 'no'

export interface Capability {
  group: string            // e.g. 'Loan Operations'
  label: string            // e.g. 'Delete entire loan'
  access: Record<RoleKey, Access>
  note?: string
  source?: string          // file path the rule lives in, for traceability
}

export const ROLES: { key: RoleKey; label: string }[] = [...]
export const CAPABILITIES: Capability[] = [...]   // the Section 5 matrix, encoded
```

The Settings page renders straight from this. When later phases make permissions
editable, the catalog becomes the schema the editor reads/writes against.

## 4. UI - `/admin/settings`

- **Route:** `src/app/admin/settings/page.tsx`, an async server component.
- **Guard:** same pattern as `/admin/admins` - load the `admin_users` row; if not
  found redirect `/login`; if `is_super !== true` redirect `/admin`. (Defense in depth:
  the nav item is also only rendered for super-admins.)
- **Shell:** `<PortalShell variant="admin" isSuperAdmin>` like other admin pages.
- **Nav:** add a "Settings" item to the super-admin nav in
  `src/components/portal-shell.tsx`. Today `SUPER_ADMIN_EXTRA` is a single item
  (`/admin/admins`); generalize to also include
  `{ href: '/admin/settings', label: 'Settings', icon: Settings }`. The `Settings`
  icon from `lucide-react`.

### Page layout (cards)

1. **Session & Security** (read-only)
   - Idle timeout: `2 hours`
   - Absolute session cap: `12 hours`
   - Helper text: "These currently apply to all staff. Editing from here is coming in
     a future update." Values come from `session-config.ts`.

2. **Roles & Permissions** (read-only matrix)
   - Rows grouped by `Capability.group`; columns = the five roles.
   - Cell rendering: `yes` -> check; `assigned` -> check + "assigned" tag;
     `super` -> "Super-admin"; `no` -> dash. `note` shown as a small caption.
   - Rendered from `permissions/catalog.ts`. Reuse `src/components/ui/table.tsx`,
     `badge.tsx`, `card.tsx`.
   - A short legend explains `assigned` (scoped to loans the user is assigned to) and
     `super` (admin sub-tier).

No client interactivity required beyond what shadcn table/card provide - this can be
almost entirely a server component (a small client component only if a
group-collapse affordance is wanted; optional).

## 5. Current roles & permissions matrix (reverse-engineered, code-verified)

Source of truth for `permissions/catalog.ts`. Legend: **Y** = full, **A** = assigned
loans only, **S** = super-admin only, **-** = not allowed.

### Management
| Capability | Admin | LO | LP | UW | Borrower | Source |
|---|---|---|---|---|---|---|
| Manage admin users (create/delete) | S | - | - | - | - | `/api/admin/admins` (`verifySuperAdmin`) |
| Manage loan officers | Y | - | - | - | - | `/api/admin/loan-officers` |
| Manage loan processors | Y | - | - | - | - | `/api/admin/loan-processors` |
| Manage underwriters | Y | - | - | - | - | `/api/admin/underwriters` |
| Manage/delete borrowers | Y | - | - | - | - | `/api/admin/borrowers` |
| Manage/delete brokers | Y | - | - | - | - | `/api/admin/brokers` |
| Invite staff (LO/LP/UW) | Y | - | - | - | - | `/api/admin/*/invite` |
| Manage vendors | Y | - | - | - | - | `/admin/vendors` (view for LO/LP) |

### Loan operations
| Capability | Admin | LO | LP | UW | Borrower | Source |
|---|---|---|---|---|---|---|
| View loans | Y | A | A | A | own | role pages + page guards |
| Assign LO/LP/UW to a loan | Y | - | - | - | - | `/api/admin/assign-*` |
| Delete entire loan (cascade) | Y | - | - | - | - | `/api/admin/loans/delete` |
| Edit loan fields (Pipedrive sync) | Y | A | A | A | - | `/api/loans/field` (FIELD_WHITELIST) |
| Change pipeline stage | Y | A | A | A | - | `/api/loans/stage` |
| Change loan status (active/hold/cancel) | Y | A | A | A | - | `/api/loans/status` |
| Archive / unarchive loan | Y | - | - | - | - | `/api/admin/archive` |
| Claim / unclaim loan (self-assign) | - | - | Y (after Processing stage) | Y (at Pre-UW+ stage) | - | `/api/loan-processor/claim`, `/api/underwriter/claim` |

### Conditions & templates
| Capability | Admin | LO | LP | UW | Borrower | Source |
|---|---|---|---|---|---|---|
| Create conditions | Y | A | A | A | - | `/api/{role}/conditions`, `/api/admin/conditions` |
| Update condition status | Y | A (can mark Satisfied) | A (can mark Satisfied) | A (full authority) | borrower-assigned only | `/api/{role}/conditions` |
| Delete conditions | Y | - | - | A | - | `/api/admin/conditions`, `/api/underwriter/conditions` |
| Respond to conditions | Y | A | A | A | borrower-assigned only | `/api/loans/conditions/response` (borrower/broker) |
| Manage condition templates | Y | - | Y | Y | - | `/api/templates` (admin+UW+LP), `/api/admin/templates` |

### Documents
| Capability | Admin | LO | LP | UW | Borrower | Source |
|---|---|---|---|---|---|---|
| Upload documents | Y | A | A | A | borrower-assigned | `/api/{role}/upload` + `/upload/record` |
| View documents | Y | A | A | A | own loans | role loan-detail pages |

### Notes, audit & reports
| Capability | Admin | LO | LP | UW | Borrower | Source |
|---|---|---|---|---|---|---|
| Add notes | Y | A | A | A | - | `/api/loans/notes`, `/api/admin/notes` |
| Delete notes | Y | - | - | - | - | `/api/admin/notes` |
| View activity log | Y | A | A | A | own loans | loan-detail pages |
| View reports | Y | A | A | A | - | `src/lib/reports/auth.ts` |

Notes encoded as `Capability.note`:
- LO/LP can mark conditions Satisfied (after a warning) without UW confirmation; UW
  has full condition authority including delete.
- Borrower-assigned conditions can also be answered by an assigned **broker** (broker
  is a contact type, not one of the five staff roles; represented under the borrower
  column where relevant).
- "assigned" everywhere means the user is linked to the loan via
  `loan_officer_id` / `loan_processor_id`(`_2`) / `underwriter_id`.

## 6. Verification (v1)

- `npm run build` must pass (TypeScript + ESLint; the project has no test suite -
  build is the correctness gate per `feportal/CLAUDE.md`).
- Because we touch `proxy.ts` (swapping inline constants for imports of identical
  values) and add an `is_super`-gated page, run the project's `playwright-role-gates`
  check before merge to confirm:
  - the five role sign-ins still gate to their own routes (no session regression from
    the proxy edit), and
  - a non-super admin (and every non-admin role) cannot reach `/admin/settings`.
- Manual visual check: the matrix shown matches Section 5.

## 7. Explicitly deferred (roadmap, NOT in v1)

These are designed-for but not built. v1's `session-config.ts` and
`permissions/catalog.ts` are the seams they extend.

1. **Editable idle timeout** - `app_settings` table (key/value, RLS: anon read of
   non-sensitive keys), proxy reads the value with a module-scope ~60s TTL cache and
   falls back to the `session-config.ts` default on any error.
2. **Active/inactive staff** - `is_active` column on the four staff role tables; a
   staff list (all roles, active + inactive) with deactivate/reactivate; immediate
   revocation by banning the Supabase auth user so the proxy's `getUser()` rejects
   them on the next request.
3. **Per-user capability overrides + enforcement** - `staff_capabilities` table
   (`auth_user_id` -> `overrides jsonb`); a central `src/lib/auth/staff.ts` helper
   (`getStaffContext()` / `requireCapability(cap)`) that merges role defaults from the
   catalog with overrides; enforcement wired into high-value chokepoints first
   (`loans.delete`, `templates.manage`, `staff.invite`).
4. **Audit** - log settings/permission changes with the existing `loan_events`
   pattern once writes exist.

## 8. Files touched (v1)

New:
- `src/lib/session-config.ts`
- `src/lib/permissions/catalog.ts`
- `src/app/admin/settings/page.tsx`
- (optional) `src/components/admin-permissions-matrix.tsx` if a client-side
  collapse affordance is wanted; otherwise the matrix is inline server-rendered.

Edited:
- `src/proxy.ts` - import constants from `session-config.ts` (no behavior change).
- `src/components/portal-shell.tsx` - add the super-admin "Settings" nav item.
