-- MyDay schema (applied to Supabase project hcvjiveloioftozvnbhe).
-- All tables are namespaced with myday_ so the app can share a project with others.
-- Single patient for now; every row carries patient_id so multi-patient is a small change later.

-- ---------- settings (single row, keyed by patient_id) ----------
create table if not exists myday_settings (
  patient_id   uuid primary key default '00000000-0000-0000-0000-000000000001',
  patient_name text not null default 'Dad',
  timezone     text not null default 'UTC',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- medications ----------
create table if not exists myday_medications (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null default '00000000-0000-0000-0000-000000000001',
  name       text not null,
  dose       text not null default '',
  times      text[] not null default '{}',   -- e.g. {'09:00','20:00'} local wall-clock
  note       text,                            -- e.g. 'take with food'
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- doses (one row per medication per scheduled time per day) ----------
create table if not exists myday_doses (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null default '00000000-0000-0000-0000-000000000001',
  medication_id  uuid not null references myday_medications(id) on delete cascade,
  dose_date      date not null,
  scheduled_time text not null,               -- 'HH:MM' local wall-clock
  due_at         timestamptz not null,        -- absolute instant the dose is due
  status         text not null default 'pending' check (status in ('pending','taken','missed')),
  taken_at       timestamptz,
  notified       boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (medication_id, dose_date, scheduled_time)
);
create index if not exists myday_doses_date_idx   on myday_doses (dose_date);
create index if not exists myday_doses_status_idx on myday_doses (status);
create index if not exists myday_doses_due_idx    on myday_doses (due_at);

-- ---------- appointments ----------
create table if not exists myday_appointments (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null default '00000000-0000-0000-0000-000000000001',
  appt_date   date not null,
  appt_time   text,                           -- 'HH:MM' local, nullable
  doctor_name text,
  location    text,
  reason      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists myday_appts_date_idx on myday_appointments (appt_date);

-- ---------- game results ----------
create table if not exists myday_game_results (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null default '00000000-0000-0000-0000-000000000001',
  game_type        text not null check (game_type in ('match_pairs','word_puzzle','number_pattern','orientation')),
  score            int not null default 0,
  max_score        int,
  difficulty       int not null default 1,
  duration_seconds int,
  details          jsonb,
  played_at        timestamptz not null default now()
);
create index if not exists myday_games_type_idx   on myday_game_results (game_type);
create index if not exists myday_games_played_idx on myday_game_results (played_at);

-- ---------- family devices (web-push subscriptions) ----------
create table if not exists myday_family_devices (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null default '00000000-0000-0000-0000-000000000001',
  label            text,
  endpoint         text not null unique,
  subscription     jsonb not null,
  last_notified_at timestamptz,
  created_at       timestamptz not null default now()
);

-- ---------- updated_at trigger ----------
create or replace function myday_set_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists myday_medications_updated on myday_medications;
create trigger myday_medications_updated before update on myday_medications
  for each row execute function myday_set_updated_at();

drop trigger if exists myday_appointments_updated on myday_appointments;
create trigger myday_appointments_updated before update on myday_appointments
  for each row execute function myday_set_updated_at();

drop trigger if exists myday_settings_updated on myday_settings;
create trigger myday_settings_updated before update on myday_settings
  for each row execute function myday_set_updated_at();

insert into myday_settings (patient_id, patient_name, timezone)
values ('00000000-0000-0000-0000-000000000001', 'Dad', 'UTC')
on conflict (patient_id) do nothing;

-- =====================================================================
-- Row Level Security
-- This app has NO login (the patient has mild dementia; a login screen would be
-- a barrier to daily use). Access is via the public publishable key, so these
-- policies intentionally allow anon/authenticated full access to the myday_
-- tables only. See README "Security model" for how to add Supabase Auth later.
-- =====================================================================
alter table myday_settings       enable row level security;
alter table myday_medications    enable row level security;
alter table myday_doses          enable row level security;
alter table myday_appointments   enable row level security;
alter table myday_game_results   enable row level security;
alter table myday_family_devices enable row level security;

create policy myday_settings_all       on myday_settings       for all to anon, authenticated using (true) with check (true);
create policy myday_medications_all    on myday_medications    for all to anon, authenticated using (true) with check (true);
create policy myday_doses_all          on myday_doses          for all to anon, authenticated using (true) with check (true);
create policy myday_appointments_all   on myday_appointments   for all to anon, authenticated using (true) with check (true);
create policy myday_game_results_all   on myday_game_results   for all to anon, authenticated using (true) with check (true);
create policy myday_family_devices_all on myday_family_devices for all to anon, authenticated using (true) with check (true);
