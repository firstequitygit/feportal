-- Per-condition staff notes. Used by LOs/LPs/UWs/admins to leave internal
-- comments to each other about a specific condition (e.g. "still waiting
-- on the corrected appraisal", "borrower says they'll have this Friday").
--
-- Visibility is enforced at the API layer — only staff roles can read
-- or write. Borrower / co-borrower / broker / broker-processor users
-- never see these notes (the borrower-facing conditions component
-- doesn't surface them).

create table if not exists condition_notes (
  id uuid primary key default uuid_generate_v4(),
  condition_id uuid references conditions(id) on delete cascade not null,
  content text not null,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists condition_notes_condition_id_idx on condition_notes(condition_id);

-- RLS: deny by default; the staff API routes bypass RLS via the service
-- role key (createAdminClient) and enforce visibility in application code.
alter table condition_notes enable row level security;
