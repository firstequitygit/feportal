-- 20260527-staff-users-additive.sql
-- Additive-only staff identity consolidation. Reversible by dropping the new
-- objects; existing role tables and rows are untouched.

-- 1. Enum for base role (nullable on staff_users; admin-only humans have NULL).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'staff_base_role') then
    create type staff_base_role as enum ('loan_officer', 'loan_processor', 'underwriter');
  end if;
end$$;

-- 2. staff_users: 1:1 with auth.users for staff humans only.
create table if not exists public.staff_users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  phone         text,
  title         text,
  base_role     staff_base_role,
  is_admin      boolean not null default false,
  is_super      boolean not null default false,
  last_view_mode text not null default 'base' check (last_view_mode in ('admin','base')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists staff_users_auth_user_id_idx on public.staff_users(auth_user_id);
create index if not exists staff_users_base_role_idx on public.staff_users(base_role) where base_role is not null;
create index if not exists staff_users_is_admin_idx on public.staff_users(is_admin) where is_admin = true;

-- 3. Add staff_user_id FK to existing role-detail tables (nullable, backfilled below).
alter table public.loan_officers   add column if not exists staff_user_id uuid references public.staff_users(id) on delete set null;
alter table public.loan_processors add column if not exists staff_user_id uuid references public.staff_users(id) on delete set null;
alter table public.underwriters    add column if not exists staff_user_id uuid references public.staff_users(id) on delete set null;
alter table public.admin_users     add column if not exists staff_user_id uuid references public.staff_users(id) on delete set null;

create index if not exists loan_officers_staff_user_id_idx   on public.loan_officers(staff_user_id);
create index if not exists loan_processors_staff_user_id_idx on public.loan_processors(staff_user_id);
create index if not exists underwriters_staff_user_id_idx    on public.underwriters(staff_user_id);
create index if not exists admin_users_staff_user_id_idx     on public.admin_users(staff_user_id);

-- 4. Backfill staff_users from admin_users (admins win — they may also have a base role).
--    admin_users.role is today 'admin' or 'loan_officer'. Map accordingly.
insert into public.staff_users (auth_user_id, email, full_name, is_admin, is_super, base_role)
select
  au.auth_user_id,
  au.email,
  au.full_name,
  true,
  coalesce(au.is_super, false),
  case when au.role = 'loan_officer' then 'loan_officer'::staff_base_role else null end
from public.admin_users au
where au.auth_user_id is not null
on conflict (auth_user_id) do nothing;

-- 5. Backfill staff_users from loan_officers (skip if already in staff_users via admin path).
insert into public.staff_users (auth_user_id, email, full_name, phone, title, base_role, is_admin)
select
  lo.auth_user_id,
  lo.email,
  lo.full_name,
  lo.phone,
  lo.title,
  'loan_officer'::staff_base_role,
  false
from public.loan_officers lo
where lo.auth_user_id is not null
on conflict (auth_user_id) do nothing;

-- 6. Backfill staff_users from loan_processors.
insert into public.staff_users (auth_user_id, email, full_name, phone, title, base_role, is_admin)
select
  lp.auth_user_id,
  lp.email,
  lp.full_name,
  lp.phone,
  lp.title,
  'loan_processor'::staff_base_role,
  false
from public.loan_processors lp
where lp.auth_user_id is not null
on conflict (auth_user_id) do nothing;

-- 7. Backfill staff_users from underwriters.
insert into public.staff_users (auth_user_id, email, full_name, phone, title, base_role, is_admin)
select
  uw.auth_user_id,
  uw.email,
  uw.full_name,
  uw.phone,
  uw.title,
  'underwriter'::staff_base_role,
  false
from public.underwriters uw
where uw.auth_user_id is not null
on conflict (auth_user_id) do nothing;

-- 8. Backfill staff_user_id FK on each role table.
update public.admin_users au
   set staff_user_id = su.id
  from public.staff_users su
 where su.auth_user_id = au.auth_user_id
   and au.staff_user_id is null;

update public.loan_officers lo
   set staff_user_id = su.id
  from public.staff_users su
 where su.auth_user_id = lo.auth_user_id
   and lo.staff_user_id is null;

update public.loan_processors lp
   set staff_user_id = su.id
  from public.staff_users su
 where su.auth_user_id = lp.auth_user_id
   and lp.staff_user_id is null;

update public.underwriters uw
   set staff_user_id = su.id
  from public.staff_users su
 where su.auth_user_id = uw.auth_user_id
   and uw.staff_user_id is null;

-- 9. updated_at trigger for staff_users.
create or replace function public.tg_staff_users_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists staff_users_set_updated_at on public.staff_users;
create trigger staff_users_set_updated_at
  before update on public.staff_users
  for each row execute function public.tg_staff_users_set_updated_at();
