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
