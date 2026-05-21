-- Default DSCR-loan fields where they're consistently the same:
--   Term = 360 months  (DSCR rentals are 30-year amortizations)
--   Interest Only = No  (DSCR is amortizing, not IO)
--
-- 1,198 DSCR loans total; almost all currently NULL on both fields.
-- One-time backfill only — future DSCR loans get the same defaults
-- applied via /api/loans/field when loan_type is set to 'Rental (DSCR)'.

update loans
set term_months = 360
where loan_type = 'Rental (DSCR)' and term_months is null;

update loans
set interest_only = 'No'
where loan_type = 'Rental (DSCR)' and interest_only is null;
