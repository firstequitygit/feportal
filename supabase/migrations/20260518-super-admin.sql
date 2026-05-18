-- Add a super_admin tier. Super-admins can manage other admin users
-- (create + delete). Regular admins keep every other admin capability
-- but can't add or remove admin logins.

alter table admin_users
  add column if not exists is_super boolean not null default false;

-- Seed: the original Iron Gate admin email is the super-admin.
update admin_users
  set is_super = true
  where email = 'info@irongateportals.com';
