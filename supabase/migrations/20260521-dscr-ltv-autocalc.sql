-- DSCR loans: LTV is the loan-to-value ratio (loan_amount ÷ value_as_is).
-- Backfill every DSCR loan that has both inputs available so the Loan
-- Summary card stops showing "—" on records where the math is trivial.
--
-- LTV is stored as the percent value (e.g. 75 means 75%) to match how
-- it's rendered in the UI ("75%").
--
-- API-level keep-in-sync logic lives in src/app/api/loans/field/route.ts
-- (recomputes whenever loan_amount, value_as_is, or loan_type changes).

update loans l
set ltv = round(((l.loan_amount / d.value_as_is) * 100)::numeric, 2)
from loan_details d
where d.loan_id = l.id
  and l.loan_type = 'Rental (DSCR)'
  and l.loan_amount is not null and l.loan_amount > 0
  and d.value_as_is is not null and d.value_as_is > 0;
