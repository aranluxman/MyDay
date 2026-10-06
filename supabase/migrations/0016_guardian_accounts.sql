-- Account owners may also be read-only guardians of other MyDay users.
-- This table is server-only. A device is linked to an account only after its
-- owner proves possession of a valid single-use code or device token.
create table if not exists myday_guardian_accounts (
  device_id uuid primary key references myday_guardian_devices(id) on delete cascade,
  guardian_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists myday_guardian_accounts_user_idx
  on myday_guardian_accounts (guardian_user_id);
alter table myday_guardian_accounts enable row level security;
-- No anon/authenticated policy: only the guardian-data Edge Function's service
-- role can manage account links, and it verifies the session on every request.
revoke all on myday_guardian_accounts from anon, authenticated;
