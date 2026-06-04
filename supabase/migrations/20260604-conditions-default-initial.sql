-- Backfill any existing uncategorized conditions to 'Initial
-- Conditions' so the per-condition Category dropdown can drop the
-- "Uncategorized" option without orphaning legacy rows.
--
-- New conditions inserted without an explicit category now land in
-- 'initial' instead of NULL, so the dropdown UI only ever sees the
-- four real categories.

update conditions set category = 'initial' where category is null;

alter table conditions alter column category set default 'initial';
