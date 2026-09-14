-- =====================================================================
-- 0007 — three fixes for older-adult usability:
--   1. Profile saving was rejected by the for_whom CHECK constraint. The
--      onboarding flow writes 'self'/'other' but the profile editor wrote
--      'myself'/'loved_one', so every profile save raised 23514 and the user
--      only ever saw "Could not save." Normalise the data and keep one
--      vocabulary ('self' | 'other'), which the UI now uses everywhere.
--   2. Guardians pair with a short 6-digit CODE the patient reads aloud,
--      instead of a long link they have to send. The link still works.
--   3. A short code is guessable, so code lookups in the public
--      guardian-join function are rate-limited per caller.
-- =====================================================================

-- ---------- 1. profile: one vocabulary for for_whom ----------
update myday_profiles set for_whom = 'self'  where for_whom = 'myself';
update myday_profiles set for_whom = 'other' where for_whom in ('loved_one', 'loved one');
update myday_profiles set for_whom = null    where for_whom is not null and for_whom not in ('self', 'other');

alter table myday_profiles drop constraint if exists myday_profiles_for_whom_check;
alter table myday_profiles add constraint myday_profiles_for_whom_check
  check (for_whom is null or for_whom in ('self', 'other'));

-- ---------- 2. guardian pairing codes ----------
alter table myday_guardians add column if not exists code text;
create unique index if not exists myday_guardians_code_uidx on myday_guardians (code) where code is not null;

-- SECURITY DEFINER so the uniqueness probe can see every row: under RLS a
-- patient can only see their own guardians and would happily mint a code that
-- already belongs to someone else. It returns a random number and nothing else.
create or replace function myday_new_guardian_code()
returns text language plpgsql security definer set search_path = public as $$
declare c text; tries int := 0;
begin
  loop
    c := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from myday_guardians where code = c);
    tries := tries + 1;
    if tries > 60 then raise exception 'could not allocate a guardian code'; end if;
  end loop;
  return c;
end $$;
grant execute on function myday_new_guardian_code() to authenticated;

update myday_guardians set code = myday_new_guardian_code() where code is null;
alter table myday_guardians alter column code set default myday_new_guardian_code();
alter table myday_guardians alter column code set not null;

-- A code is only guessable while it is alive, so keep the window tight at 14
-- days. The patient can mint a fresh code with one tap whenever they need to.
alter table myday_guardians alter column expires_at set default (now() + interval '14 days');

-- ---------- 3. throttle code guessing ----------
-- RLS on with no policy: only the service role (the edge function) touches it.
create table if not exists myday_join_attempts (
  client_key text primary key,
  attempts int not null default 0,
  window_start timestamptz not null default now()
);
alter table myday_join_attempts enable row level security;

-- Counts one attempt and returns true when the caller is over budget. Two
-- layers: a tight per-caller budget (p_max failures inside p_window_minutes),
-- and a much looser GLOBAL budget, because per-IP limits alone are bypassable
-- by an attacker rotating addresses. No real household comes near 120 wrong
-- codes in 15 minutes; a sweep of the 900k code space does immediately.
create or replace function myday_join_rate_limited(
  p_key text, p_max int default 8, p_window_minutes int default 15
) returns boolean language plpgsql security definer set search_path = public as $$
declare n int; g int;
begin
  insert into myday_join_attempts (client_key, attempts, window_start)
  values (p_key, 1, now())
  on conflict (client_key) do update
    set attempts = case when myday_join_attempts.window_start < now() - make_interval(mins => p_window_minutes)
                        then 1 else myday_join_attempts.attempts + 1 end,
        window_start = case when myday_join_attempts.window_start < now() - make_interval(mins => p_window_minutes)
                        then now() else myday_join_attempts.window_start end
  returning attempts into n;

  insert into myday_join_attempts (client_key, attempts, window_start)
  values ('__global__', 1, now())
  on conflict (client_key) do update
    set attempts = case when myday_join_attempts.window_start < now() - make_interval(mins => p_window_minutes)
                        then 1 else myday_join_attempts.attempts + 1 end,
        window_start = case when myday_join_attempts.window_start < now() - make_interval(mins => p_window_minutes)
                        then now() else myday_join_attempts.window_start end
  returning attempts into g;

  return n > p_max or g > 120;
end $$;
revoke all on function myday_join_rate_limited(text, int, int) from public, anon, authenticated;
grant execute on function myday_join_rate_limited(text, int, int) to service_role;

-- A successful pairing clears that caller's counter, and decrements (never
-- resets) the global one, so a lucky hit mid-sweep cannot reopen the breaker.
create or replace function myday_join_rate_clear(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from myday_join_attempts where client_key = p_key;
  update myday_join_attempts set attempts = greatest(0, attempts - 1) where client_key = '__global__';
end $$;
revoke all on function myday_join_rate_clear(text) from public, anon, authenticated;
grant execute on function myday_join_rate_clear(text) to service_role;
