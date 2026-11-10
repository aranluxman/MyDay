-- Redesign phase 2: health profile fields, health tracker logs, appointment notes.
-- ADD-ONLY: new nullable columns and one new table. Nothing existing is
-- changed, renamed or removed, and no existing row is rewritten.

-- ---------- health profile ----------
-- Every field is optional. `allergies_none` exists so "No known allergies"
-- (a real answer) is never confused with "Not entered" (no answer).
-- Height and weight are stored in metric; the *_unit columns only remember
-- which unit the person likes to read and type. Weight keeps two decimals of
-- a kilogram so a weight typed in pounds reads back as the same pounds.
alter table myday_profiles
  add column if not exists gender text,
  add column if not exists height_cm numeric(5,1),
  add column if not exists weight_kg numeric(6,2),
  add column if not exists height_unit text not null default 'cm',
  add column if not exists weight_unit text not null default 'kg',
  add column if not exists conditions text,
  add column if not exists allergies text,
  add column if not exists allergies_none boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'myday_profiles_gender_check') then
    alter table myday_profiles add constraint myday_profiles_gender_check
      check (gender is null or gender in ('woman', 'man', 'non_binary', 'other', 'prefer_not_to_say'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'myday_profiles_height_check') then
    alter table myday_profiles add constraint myday_profiles_height_check
      check (height_cm is null or (height_cm >= 50 and height_cm <= 260));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'myday_profiles_weight_check') then
    alter table myday_profiles add constraint myday_profiles_weight_check
      check (weight_kg is null or (weight_kg >= 20 and weight_kg <= 400));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'myday_profiles_units_check') then
    alter table myday_profiles add constraint myday_profiles_units_check
      check (height_unit in ('cm', 'ft_in') and weight_unit in ('kg', 'lb'));
  end if;
  -- "No known allergies" and a list of allergies cannot both be true.
  if not exists (select 1 from pg_constraint where conname = 'myday_profiles_allergies_check') then
    alter table myday_profiles add constraint myday_profiles_allergies_check
      check (not (allergies_none and coalesce(btrim(allergies), '') <> ''));
  end if;
end $$;

-- ---------- appointment notes ----------
alter table myday_appointments add column if not exists notes text;

-- ---------- health tracker ----------
-- One row per reading the person typed in. Nothing is ever inferred or
-- filled in: a day with no row is a day with no reading.
--   water          value = amount, unit = 'glass' | 'ml'
--   sleep          value = minutes asleep, unit = 'min'
--   weight         value = kilograms, unit = 'kg' | 'lb' (the unit typed in)
--   blood_pressure value = systolic, value2 = diastolic, unit = 'mmHg'
--   heart_rate     value = beats per minute, unit = 'bpm'
-- The ranges only reject typing mistakes (a pulse of 900); they are not
-- health targets and nothing in MyDay judges a reading.
create table if not exists myday_health_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('water', 'sleep', 'weight', 'blood_pressure', 'heart_rate')),
  value numeric(8,2) not null,
  value2 numeric(8,2),
  unit text not null,
  note text check (note is null or char_length(note) <= 500),
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint myday_health_logs_shape check (
    (kind = 'water' and unit in ('glass', 'ml') and value2 is null
      and value > 0 and value <= case unit when 'glass' then 40 else 10000 end)
    or (kind = 'sleep' and unit = 'min' and value2 is null and value >= 1 and value <= 1440)
    or (kind = 'weight' and unit in ('kg', 'lb') and value2 is null and value >= 20 and value <= 400)
    or (kind = 'blood_pressure' and unit = 'mmHg' and value2 is not null
      and value >= 50 and value <= 300 and value2 >= 20 and value2 <= 200 and value > value2)
    or (kind = 'heart_rate' and unit = 'bpm' and value2 is null and value >= 20 and value <= 250)
  ),
  -- A reading cannot be dated in the future (one day of slack for time zones).
  constraint myday_health_logs_not_future check (logged_at <= created_at + interval '1 day')
);
create index if not exists myday_health_logs_user_kind_at on myday_health_logs (user_id, kind, logged_at desc);

drop trigger if exists t_myday_health_logs_u on myday_health_logs;
create trigger t_myday_health_logs_u before update on myday_health_logs
  for each row execute function myday_set_updated_at();

-- Private to the person who logged it. Guardians have no access: the guardian
-- functions use their own queries and none of them reads this table.
alter table myday_health_logs enable row level security;
drop policy if exists myday_health_logs_own on myday_health_logs;
create policy myday_health_logs_own on myday_health_logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on myday_health_logs from anon;
