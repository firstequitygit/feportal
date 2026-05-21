-- Widen loans.interest_rate from numeric(5,3) to numeric(7,5).
--
-- The previous (5,3) layout = 5 total digits, 3 after the decimal — fine for
-- percent-form values like 7.375, but loses precision for fraction-form
-- values like 0.07375 (Airtable's storage convention). 0.07375 was being
-- rounded down to 0.074 on insert, displaying as 7.400% instead of 7.375%.
--
-- (7,5) = 7 total digits, 5 after the decimal — accommodates 99.99999%
-- (well above any real rate) AND fraction-form 0.07375 down to 5 decimal
-- places. No risk to existing data: every previous value fits the new type.

alter table loans
  alter column interest_rate type numeric(7, 5);
