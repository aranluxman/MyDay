-- =====================================================================
-- Guardians: a guardian is a *different person on a different device* who
-- receives an elderly user's medication alerts via web push. Unlike
-- myday_family_devices (a device the patient registers on their own session),
-- a guardian links through a shareable invite token and never signs in.
--   - myday_guardians:        one row per invited guardian, owned by the patient
--   - myday_guardian_devices: that guardian's push subscriptions
-- The guardian's join flow runs through the service-role `guardian-join` edge
-- function (the token is the bearer of authority, and expires after 7 days), so
-- no anon RLS policy exists. The patient can regenerate an invite (fresh token +
-- expiry) if a link leaks or lapses.
-- =====================================================================

create table if not exists myday_guardians (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  phone text,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null default now() + interval '7 days',
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  activated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists myday_guardians_user_idx on myday_guardians (user_id);

create table if not exists myday_guardian_devices (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references myday_guardians(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  last_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists myday_guardian_devices_guardian_idx on myday_guardian_devices (guardian_id);

-- RLS: the patient owns and manages their guardians. Guardian devices are
-- visible/manageable by the patient through the parent guardian row. Guardian
-- writes happen via the service role (which bypasses RLS).
alter table myday_guardians enable row level security;
alter table myday_guardian_devices enable row level security;

create policy myday_guardians_own on myday_guardians for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy myday_guardian_devices_own on myday_guardian_devices for all to authenticated
  using (exists (select 1 from myday_guardians g where g.id = guardian_id and g.user_id = auth.uid()))
  with check (exists (select 1 from myday_guardians g where g.id = guardian_id and g.user_id = auth.uid()));
