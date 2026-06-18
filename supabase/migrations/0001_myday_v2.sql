-- =====================================================================
-- MyDay v2 backend (multi-user, Supabase Auth) for project zciulgqkqusjxomyapcz.
-- Every table is owned by an auth user (user_id = auth.uid()) with per-user RLS.
-- All tables namespaced myday_ to coexist with the other app in this project.
-- =====================================================================

create table if not exists myday_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  full_name text, birthday date, age int,
  on_treatment text, goal text,
  timezone text not null default 'UTC', theme text not null default 'light',
  avatar_color text not null default '#2563a8',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists myday_medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null, dose text not null default '', times text[] not null default '{}',
  note text, color text not null default '#2563a8', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists myday_doses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  medication_id uuid not null references myday_medications(id) on delete cascade,
  dose_date date not null, scheduled_time text not null, due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','taken','missed')),
  taken_at timestamptz, notified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (medication_id, dose_date, scheduled_time)
);
create index if not exists myday_doses_user_date_idx on myday_doses (user_id, dose_date);
create table if not exists myday_appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  appt_date date not null, appt_time text, doctor_name text, location text, reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists myday_game_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  game_type text not null check (game_type in ('match_pairs','word_puzzle','number_pattern','orientation')),
  score int not null default 0, max_score int, difficulty int not null default 1,
  duration_seconds int, details jsonb, played_at timestamptz not null default now()
);
create table if not exists myday_family_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  label text, endpoint text not null unique, subscription jsonb not null,
  last_notified_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists myday_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  type text not null default 'other' check (type in ('pharmacy','merchant','insurance','provider','clinic','other')),
  name text not null, phone text, email text, address text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists myday_diary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  entry_at timestamptz not null default now(),
  category text not null default 'note' check (category in ('symptom','event','note','other')),
  title text, body text, created_at timestamptz not null default now()
);
-- server-only VAPID config (RLS on, no policy -> only the service role can read)
create table if not exists myday_push_config (
  id int primary key default 1, vapid_public text not null, vapid_private text not null,
  contact text not null default 'mailto:admin@example.com', updated_at timestamptz not null default now(),
  constraint myday_push_config_singleton check (id = 1)
);

-- updated_at
create or replace function myday_set_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_myday_profiles_u before update on myday_profiles for each row execute function myday_set_updated_at();
create trigger t_myday_meds_u before update on myday_medications for each row execute function myday_set_updated_at();
create trigger t_myday_appts_u before update on myday_appointments for each row execute function myday_set_updated_at();
create trigger t_myday_contacts_u before update on myday_contacts for each row execute function myday_set_updated_at();

-- RLS: per-user, login required (no anon access)
alter table myday_profiles enable row level security;
alter table myday_medications enable row level security;
alter table myday_doses enable row level security;
alter table myday_appointments enable row level security;
alter table myday_game_results enable row level security;
alter table myday_family_devices enable row level security;
alter table myday_contacts enable row level security;
alter table myday_diary enable row level security;
alter table myday_push_config enable row level security;
create policy myday_profiles_own on myday_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy myday_medications_own on myday_medications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy myday_doses_own on myday_doses for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy myday_appointments_own on myday_appointments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy myday_game_results_own on myday_game_results for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy myday_family_devices_own on myday_family_devices for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy myday_contacts_own on myday_contacts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy myday_diary_own on myday_diary for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- (myday_push_config has no policy -> only the service role can read it)
