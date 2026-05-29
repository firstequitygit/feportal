-- Optional "specific staff member" pin on a condition. When set, the
-- condition is targeted at exactly one person instead of fanning out to
-- everyone in the role on the loan.
--
-- The column holds the UUID from whichever staff table matches the
-- condition's assigned_to role:
--   assigned_to='loan_officer'   → loan_officers.id
--   assigned_to='loan_processor' → loan_processors.id
--   assigned_to='underwriter'    → underwriters.id
--   assigned_to='borrower'       → always NULL (the role-only model)
--
-- We don't add a FK because the target table varies by assigned_to —
-- the writing routes validate the (role, id) pair against the loan's
-- assigned staff before saving.

alter table conditions
  add column if not exists assigned_to_staff_id uuid;
