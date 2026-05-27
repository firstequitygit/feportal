-- portal_settings: key/value store for admin-editable runtime configuration.
-- v1 holds a single key (applications_processing_inbox); table is generic to allow future settings.
-- Named portal_settings to avoid collision with the existing app_settings table (session/maintenance config).

create table portal_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table portal_settings enable row level security;

create policy "portal_settings admin select" on portal_settings for select
  using (exists (select 1 from admin_users where auth_user_id = auth.uid()));

create policy "portal_settings admin insert" on portal_settings for insert
  with check (exists (select 1 from admin_users where auth_user_id = auth.uid()));

create policy "portal_settings admin update" on portal_settings for update
  using (exists (select 1 from admin_users where auth_user_id = auth.uid()));

comment on table portal_settings is 'Admin-editable runtime configuration. One row per setting key.';
comment on column portal_settings.value is 'Empty string is a valid value (means "unset by admin choice"). Distinguish from missing row, which means "never configured".';
