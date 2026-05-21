-- Default Amortization Schedule based on loan_type:
--   Rental (DSCR)        → '30-yr'  (amortizing 30-year rentals)
--   Fix & Flip (Bridge)  → 'Interest Only'
--   New Construction     → 'Interest Only'
--
-- Two passes:
--   1. Update existing loan_details rows that have amortization_schedule = NULL
--   2. Insert a loan_details row for loans that don't have one yet, with the
--      right default baked in

-- (1) Backfill existing rows
update loan_details d
set amortization_schedule = case l.loan_type
    when 'Rental (DSCR)' then '30-yr'
    when 'Fix & Flip (Bridge)' then 'Interest Only'
    when 'New Construction' then 'Interest Only'
  end,
  updated_at = now()
from loans l
where l.id = d.loan_id
  and l.loan_type in ('Rental (DSCR)', 'Fix & Flip (Bridge)', 'New Construction')
  and d.amortization_schedule is null;

-- (2) Create loan_details rows for loans that don't have one yet
insert into loan_details (loan_id, amortization_schedule, updated_at)
select l.id,
  case l.loan_type
    when 'Rental (DSCR)' then '30-yr'
    else 'Interest Only'
  end,
  now()
from loans l
where l.loan_type in ('Rental (DSCR)', 'Fix & Flip (Bridge)', 'New Construction')
  and not exists (select 1 from loan_details d where d.loan_id = l.id);
