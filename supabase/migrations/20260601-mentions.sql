-- @mentions notifications.
--
-- When staff write "@FirstLast" in a staff note, condition note, or
-- condition text response, the mentioned person gets a row here. The
-- mentioned-person's inbox shows unread rows; the sidebar Inbox count
-- includes them; an email goes out at creation time.
--
-- A single textbox submission can produce N rows — one per distinct
-- person mentioned. read_at flips to non-null when they tap the entry
-- in their inbox.

create table if not exists mentions (
  id uuid primary key default uuid_generate_v4(),

  -- Who got mentioned. mentioned_user_kind picks which role table the
  -- mentioned_user_id points at — admins can be tagged too, but they
  -- live in admin_users, not the staff role tables.
  mentioned_user_kind text not null
    check (mentioned_user_kind in ('admin', 'loan_officer', 'loan_processor', 'underwriter')),
  mentioned_user_id uuid not null,

  -- Author of the textbox that contained the @mention. Stored as a
  -- display string (rather than a foreign-key per role table) so the
  -- inbox can show "by Adam Scovill" without a join.
  mentioned_by_name text,

  -- Where the mention happened — drives the deep link in the email
  -- and the inbox row. source_id points at:
  --   staff_note         → loan_notes.id
  --   condition_note     → condition_notes.id
  --   condition_response → conditions.id (the response field lives on
  --                         the conditions row itself)
  source_kind text not null
    check (source_kind in ('staff_note', 'condition_note', 'condition_response')),
  source_id uuid not null,

  -- Loan context is denormalized so the inbox can render
  -- "@Adam on 1023 Monroe Ave" without an extra hop through the
  -- source table. condition_id is also denormalized for the same reason
  -- when the source is condition-scoped.
  loan_id uuid not null references loans(id) on delete cascade,
  condition_id uuid references conditions(id) on delete cascade,

  -- Short snippet of the surrounding text so the inbox row has
  -- context without needing to click through.
  excerpt text,

  -- Null = unread; timestamp = when the mentionee marked it read.
  read_at timestamptz,
  created_at timestamptz default now() not null
);

-- Fast unread-count lookup: most calls are "how many unread for THIS user".
create index if not exists idx_mentions_user_unread
  on mentions (mentioned_user_kind, mentioned_user_id)
  where read_at is null;

create index if not exists idx_mentions_loan on mentions (loan_id);
