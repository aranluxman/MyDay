-- Daily 8pm summary: once a day, at 8pm in the user's own timezone, push a short
-- recap of the day's doses to their family devices and active guardians.
-- Deduped per local day via myday_profiles.summary_sent_on. An hourly cron lets
-- every user fire at their own local 8pm regardless of timezone.

alter table myday_profiles
  add column if not exists summary_sent_on date;

-- Users whose local time is in the 8pm hour and who haven't had today's summary
-- yet. Returns the user's local "today" so the caller can stamp summary_sent_on.
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

-- Cron: hit the daily-summary Edge Function every hour.
do $$ begin perform cron.unschedule('myday-daily-summary'); exception when others then null; end $$;
select cron.schedule('myday-daily-summary', '0 * * * *', $job$
  select net.http_post(
    url := 'https://zciulgqkqusjxomyapcz.supabase.co/functions/v1/daily-summary',
    headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$job$);
