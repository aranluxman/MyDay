-- Dose generation + the missed-dose cron.

-- Client-facing (SECURITY INVOKER -> RLS scopes to the signed-in user): ensure
-- yesterday+today doses exist in the given timezone, then mark overdue ones missed.
create or replace function myday_refresh_doses(p_timezone text default 'UTC')
returns void language plpgsql security invoker set search_path = public as $$
declare local_today date := (now() at time zone p_timezone)::date;
begin
  insert into myday_doses (user_id, medication_id, dose_date, scheduled_time, due_at, status)
  select m.user_id, m.id, g.dd, t.time_str,
         ((g.dd::text || ' ' || t.time_str || ':00')::timestamp at time zone p_timezone), 'pending'
  from myday_medications m
  cross join lateral unnest(m.times) as t(time_str)
  cross join lateral (values (local_today - 1), (local_today)) as g(dd)
  where m.active
  on conflict (medication_id, dose_date, scheduled_time) do nothing;
  update myday_doses set status = 'missed' where status = 'pending' and due_at < now() - interval '1 hour';
end; $$;
grant execute on function myday_refresh_doses(text) to authenticated;

-- Cron-facing (SECURITY DEFINER, all users, each in their own profile timezone).
create or replace function myday_cron_ensure_and_mark()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into myday_doses (user_id, medication_id, dose_date, scheduled_time, due_at, status)
  select m.user_id, m.id, g.dd, t.time_str,
         ((g.dd::text || ' ' || t.time_str || ':00')::timestamp at time zone coalesce(p.timezone,'UTC')), 'pending'
  from myday_medications m
  join myday_profiles p on p.user_id = m.user_id
  cross join lateral unnest(m.times) as t(time_str)
  cross join lateral (values
    ((now() at time zone coalesce(p.timezone,'UTC'))::date - 1),
    ((now() at time zone coalesce(p.timezone,'UTC'))::date)) as g(dd)
  where m.active
  on conflict (medication_id, dose_date, scheduled_time) do nothing;
  update myday_doses set status = 'missed' where status = 'pending' and due_at < now() - interval '1 hour';
end; $$;
revoke all on function myday_cron_ensure_and_mark() from public, anon, authenticated;
grant execute on function myday_cron_ensure_and_mark() to service_role;

-- Cron: hit the missed-dose Edge Function every 5 minutes.
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('myday-missed-dose-check'); exception when others then null; end $$;
select cron.schedule('myday-missed-dose-check', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://zciulgqkqusjxomyapcz.supabase.co/functions/v1/missed-dose-check',
    headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$job$);

-- VAPID keys are inserted out-of-band (never committed). Generate with
--   npx web-push generate-vapid-keys
-- then: insert into myday_push_config (id, vapid_public, vapid_private, contact)
--       values (1, '<public>', '<private>', 'mailto:you@example.com');
-- and put the public key in src/lib/supabase.js as VAPID_PUBLIC_KEY.

-- NOTE: this project's auth.users had a pre-existing trigger (handle_new_user)
-- that inserted a non-existent column and blocked ALL sign-ups. It was fixed to
-- insert public.profiles(id) and made exception-safe so a profile insert can
-- never again block account creation.
