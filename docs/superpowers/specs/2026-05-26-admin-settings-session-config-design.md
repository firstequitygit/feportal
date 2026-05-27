# Admin Settings hub + configurable session security

**Date:** 2026-05-26
**Status:** Approved design, ready for implementation plan
**Scope:** First iteration of a global admin settings hub. Ships four settings: idle timeout, absolute session cap, maintenance-mode banner, force-logout-all-users.

## Background

Today, session limits in FE-Portal are hardcoded in [src/proxy.ts:54-55](../../../src/proxy.ts#L54-L55):

- `IDLE_LIMIT_MS = 2 * 60 * 60 * 1000` (2 hours)
- `ABSOLUTE_LIMIT_MS = 12 * 60 * 60 * 1000` (12 hours)

These were enforced app-level rather than via Supabase native session timeouts because FE-Portal is on the Supabase free plan (Pro-only feature). Changing them requires a code change and a redeploy. Super-admins have no in-app control over session security or operational announcements.

The admin settings UI at [src/app/admin/settings/](../../../src/app/admin/settings/) currently only manages user accounts. There is no `app_config` / `app_settings` table.

## Goals

1. Let a super-admin change the idle timeout from the admin UI without a deploy.
2. Add the three highest-impact adjacent settings (absolute session cap, force-logout-all-users, maintenance banner) on the same storage layer so future settings can land cheaply.
3. Preserve the existing super-admin gating pattern and the no-middleware proxy-based auth model.

## Non-goals

- MFA enforcement, failed-login lockout, audit-log retention, file upload limits, branding, auto-disable inactive users. These were considered and deferred to a later iteration.
- Per-role timeout overrides. Uniform across all five roles for now.
- Full maintenance lockout (blocking non-admins entirely). Banner-only this iteration.
- Invalidating Supabase refresh tokens on force-logout. The proxy gate fires before any page renders, so the epoch-bump approach is sufficient.

## Decisions (locked in via brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Idle timeout, absolute session cap, force-logout-all-users, maintenance banner | "Security bundle" tier — ~1 day of work, very high impact |
| Storage | Single-row `app_settings` table with typed columns | Type-safe, simple migrations, fine for ~10-30 settings |
| Force-logout mechanism | Bump global `session_epoch` counter; proxy compares to cookie | Works on Supabase free plan, instant, no service-role loop |
| Maintenance mode | Banner only, app still works | Avoids edge cases around admin hotfixes during a lockout |
| Idle-timeout range | 0.5 to 24 hours, 0.5h steps | Covers tight-compliance (30min) through trust-the-VPN (24h) |
| Per-role timeouts | Uniform across all roles | Simpler UI, matches current proxy.ts behavior |

## Architecture

```
admin user
   |
   v
/admin/settings/general (super-admin-gated page)
   |
   v
PATCH /api/admin/settings  --writes-->  app_settings row (id=1)
                                            ^
                                            | reads (30s cache)
                                            |
            every authenticated request --> proxy.ts
                                            |
                                            v
                              enforces idle/absolute timeout
                              checks session_epoch vs cookie
                              renders maintenance banner via layout
```

Components:

- **`app_settings` table** — single row, typed columns. RLS allows super-admin read/write; proxy.ts uses the service-role client.
- **`src/lib/app-settings.ts`** — server-only helper. Exports `getAppSettings()` with a 30-second in-process cache to avoid per-request DB hits.
- **`src/proxy.ts`** — replaces hardcoded constants with values from `getAppSettings()`. Adds session-epoch cookie check.
- **`src/app/admin/settings/general/page.tsx`** — new super-admin-gated form page.
- **`src/app/api/admin/settings/route.ts`** — `PATCH` endpoint with `verifySuperAdmin()` gate and range validation.
- **`src/app/api/admin/settings/force-logout/route.ts`** — `POST` endpoint that increments `session_epoch` and logs out the caller.
- **Maintenance banner component** — rendered in an authenticated layout, hidden from `/login` and from super-admins.

## Data model

New migration: `supabase/migrations/<timestamp>-app-settings.sql`

```sql
create table app_settings (
  id smallint primary key default 1 check (id = 1),
  idle_timeout_hours numeric(3,1) not null default 2.0
    check (idle_timeout_hours between 0.5 and 24),
  absolute_session_hours integer not null default 12
    check (absolute_session_hours between 1 and 168),
  session_epoch bigint not null default 0,
  maintenance_banner_enabled boolean not null default false,
  maintenance_banner_message text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into app_settings (id) values (1);

alter table app_settings enable row level security;

create policy app_settings_super_read on app_settings
  for select using (
    exists (
      select 1 from admin_users
      where auth_user_id = auth.uid() and is_super = true
    )
  );

create policy app_settings_super_write on app_settings
  for update using (
    exists (
      select 1 from admin_users
      where auth_user_id = auth.uid() and is_super = true
    )
  );
```

The `id smallint default 1 check (id = 1)` pattern enforces single-row at the DB level.

## Server flow

### `getAppSettings()` helper

```ts
// src/lib/app-settings.ts
let cache: { value: AppSettings; expiresAt: number } | null = null;
const TTL_MS = 30_000;

export async function getAppSettings(): Promise<AppSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const value = await fetchFromSupabase(); // service-role client
  cache = { value, expiresAt: Date.now() + TTL_MS };
  return value;
}

export function invalidateAppSettingsCache(): void {
  cache = null;
}
```

`invalidateAppSettingsCache()` is called from the PATCH and force-logout endpoints so admin changes are reflected within the same request rather than waiting up to 30s.

### `proxy.ts` changes

Replace the two hardcoded constants with:

```ts
const settings = await getAppSettings();
const IDLE_LIMIT_MS = settings.idle_timeout_hours * 60 * 60 * 1000;
const ABSOLUTE_LIMIT_MS = settings.absolute_session_hours * 60 * 60 * 1000;
```

Add the epoch check:

```ts
const cookieEpoch = req.cookies.get('fe-session-epoch')?.value;
if (cookieEpoch !== String(settings.session_epoch)) {
  clearAuthCookies(res);
  return NextResponse.redirect(new URL('/login?reason=logged_out', req.url));
}
```

At login, set `fe-session-epoch` to the current `session_epoch` value (httponly, same flags as the existing `fe-last-activity` cookie).

## Admin UI

### Settings sidebar

Add "General" above "Users" in the admin settings nav. Both are super-admin-gated by the existing [src/app/admin/settings/layout.tsx](../../../src/app/admin/settings/layout.tsx).

### `/admin/settings/general` page

Form fields:

| Field | Input | Validation |
|---|---|---|
| Idle timeout (hours) | number, step 0.5 | 0.5-24 |
| Absolute session cap (hours) | number, step 1 | 1-168 |
| Maintenance banner enabled | checkbox | - |
| Maintenance banner message | textarea | required if enabled, max 500 chars |

Below the form, a destructive section:

- **Force log out all users** button — opens a confirmation dialog: "This will log out every active user, including you. You will be redirected to the login page. Continue?" On confirm, calls `POST /api/admin/settings/force-logout`.

Save button is disabled until a field changes. After save, show a toast and re-fetch settings.

### Maintenance banner component

Rendered in the authenticated root layout (above page content). Yellow background, plain text from `maintenance_banner_message`. Conditions to render:

- `maintenance_banner_enabled = true`
- Current user is not a super-admin (super-admins set the banner; they don't need to see their own announcement)
- Current route is not `/login`

A small "x" closes it for the current browser session only (localStorage flag); next session it re-appears as long as it's still enabled.

## API

### `PATCH /api/admin/settings`

Request body: partial settings object (any subset of the four user-editable fields).

```ts
{
  idle_timeout_hours?: number,
  absolute_session_hours?: number,
  maintenance_banner_enabled?: boolean,
  maintenance_banner_message?: string,
}
```

Server logic:
1. `verifySuperAdmin()` — same helper used by [src/app/api/admin/admins/route.ts:17-23](../../../src/app/api/admin/admins/route.ts#L17-L23).
2. Zod-validate the body against the column constraints (range checks mirror the DB).
3. Update the row, stamping `updated_at = now()` and `updated_by = auth.uid()`.
4. Call `invalidateAppSettingsCache()`.
5. Return the updated row.

### `POST /api/admin/settings/force-logout`

No body. Server logic:
1. `verifySuperAdmin()`.
2. `update app_settings set session_epoch = session_epoch + 1, updated_at = now(), updated_by = auth.uid() where id = 1`.
3. `invalidateAppSettingsCache()`.
4. Clear the caller's auth cookies (so the acting admin re-authenticates fresh on next request).
5. Return `{ ok: true }`.

The client then redirects to `/login?reason=logged_out`.

## Auth gate

All new admin pages and API routes follow the existing super-admin pattern:

- Pages: server-side `getUser()` → query `admin_users.is_super` → redirect to `/admin` if not super.
- APIs: `verifySuperAdmin()` helper at the top of every handler.

This must be preserved verbatim — there is no middleware, and missing role checks are the most common regression vector. The `playwright-role-gates` skill will be used at verification.

## Verification plan

1. `next build` passes (necessary, not sufficient).
2. Playwright: super-admin sets idle timeout to 0.5h. Simulate inactivity (manipulate the `fe-last-activity` cookie). Next request redirects to `/login?reason=timeout`.
3. Playwright: super-admin enables the maintenance banner. Log in as a loan officer in a second context, confirm the banner renders. Log in as a super-admin, confirm it does not render for them.
4. Playwright: super-admin triggers force-logout. Confirm the acting admin is bounced to `/login` and a previously-active session in another browser context is bounced on next navigation.
5. `playwright-role-gates`: confirm only super-admins can reach `/admin/settings/general` and `/api/admin/settings`.

## Risks

- **DB read on every request.** The 30s cache mitigates this. Worst case under cache miss is one Supabase query per request burst, which is fine at FE-Portal's scale.
- **Force-logout doesn't invalidate Supabase refresh tokens.** A user holding a valid refresh token cannot bypass the proxy gate (every request goes through it), so this is acceptable for the threat model. If a future iteration needs true session revocation, a background sweep calling `auth.admin.signOut` per user can be added without changing the storage layer.
- **Single-row constraint via primary key default.** If a future migration accidentally inserts a second row, the `check (id = 1)` predicate plus primary key prevent it. Tested via migration.

## Future iterations (out of scope)

These were considered and deferred:

- MFA required for admins (toggle that forces TOTP enrollment).
- Failed-login lockout (N attempts in M minutes → temp lockout).
- Auto-disable users inactive > N days (SOC2 / compliance ask).
- File upload size + allowed MIME types.
- Support contact info, company logo, "from" name on system emails.
- Audit-log retention (requires an audit_log table that does not yet exist).
- Per-role timeout overrides.
- Full maintenance lockout (block non-admins).
- Scheduled maintenance windows (auto-enable/disable banner at a chosen time).

Each can land on the same `app_settings` table with an additive migration.
