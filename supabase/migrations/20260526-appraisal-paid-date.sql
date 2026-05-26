-- Add Appraisal Paid Date so brokers / LOs can record when the appraisal
-- invoice was paid. Stored as text (YYYY-MM-DD) to match the other date
-- columns on loan_details (appraisal_received_date, appraisal_effective_date).

alter table loan_details
  add column if not exists appraisal_paid_date text;
