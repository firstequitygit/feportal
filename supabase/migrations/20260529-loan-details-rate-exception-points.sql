-- Two more Loan Terms point-based fields paired with Points / Broker Points
-- / Broker YSP on the Vesting/Loan Details card.
--
-- Stored the same way as the other points fields — numeric in the portal
-- (e.g. 1 means 1%). The Airtable mapping converts to fraction form
-- (0.01) via pointsForward when pushed.
--
-- Portal column                     Airtable field
-- --------------------------------  -------------------------
-- rate_costs_points                 Extension Cost - Points
-- other_exception_costs_points      SLV/Exception Points

alter table loan_details
  add column if not exists rate_costs_points numeric,
  add column if not exists other_exception_costs_points numeric;
