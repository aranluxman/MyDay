-- =====================================================================
-- Live-parity: pieces the old project (zciulgqkqusjxomyapcz) had that were
-- never committed here. Recorded during the move to cthpunnnkdgukuogyvxm so
-- this folder describes the database exactly.
--   1. The 8pm daily summary (originally "myday_daily_summary_pr11"):
--      summary_sent_on, myday_users_due_for_summary(), and its hourly cron,
--      which calls supabase/functions/daily-summary.
--   2. Lookup indexes that existed on the live tables.
-- Idempotent: safe on a database that already has any of it.
-- =====================================================================

-- ---------- 1. daily 8pm summary ----------
alter table myday_profiles
  add column if not exists summary_sent_on date;

create or replace function myday_users_due_for_summary()
returns table(user_id uuid, full_name text, local_today date)
language sql security definer set search_path = public as $$
  select p.user_id, p.full_name, (now() at time zone coalesce(p.timezone, 'UTC'))::date
  from myday_profiles p
  where extract(hour from (now() at time zone coalesce(p.timezone, 'UTC'))) = 20
    and p.summary_sent_on is distinct from (now() at time zone coalesce(p.timezone, 'UTC'))::date;
$$;
revoke all on function myday_users_due_for_summary() from public, anon, authenticated;
grant execute on function myday_users_due_for_summary() to service_role;

create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('myday-daily-summary'); exception when others then null; end $$;
select cron.schedule('myday-daily-summary', '0 * * * *', $job$
  select net.http_post(
    url := 'https://cthpunnnkdgukuogyvxm.supabase.co/functions/v1/daily-summary',
    headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$job$);

-- ---------- 2. lookup indexes ----------
create index if not exists myday_meds_user_idx on myday_medications (user_id);
create index if not exists myday_doses_status_idx on myday_doses (status);
create index if not exists myday_doses_due_idx on myday_doses (due_at);
create index if not exists myday_appts_user_idx on myday_appointments (user_id, appt_date);
create index if not exists myday_games_user_idx on myday_game_results (user_id, played_at);
create index if not exists myday_contacts_user_idx on myday_contacts (user_id);
create index if not exists myday_diary_user_idx on myday_diary (user_id, entry_at desc);

