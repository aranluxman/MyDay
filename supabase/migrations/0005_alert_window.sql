-- Customisable missed-dose alert window (per user).
-- Adds myday_profiles.alert_window_minutes and makes the dose-marking functions
-- flip a pending dose to 'missed' only after that user's chosen window has passed
-- (defaults to 60 minutes, matching the previous hard-coded behaviour).

alter table myday_profiles
  add column if not exists alert_window_minutes integer not null default 60;

-- Client-facing (SECURITY INVOKER -> RLS scopes to the signed-in user).
create or replace function myday_refresh_doses(p_timezone text default 'UTC')
returns void language plpgsql security invoker set search_path = public as $$
declare
  local_today date := (now() at time zone p_timezone)::date;
  win integer := 60;
begin
  insert into myday_doses (user_id, medication_id, dose_date, scheduled_time, due_at, status)
  select m.user_id, m.id, g.dd, t.time_str,
         ((g.dd::text || ' ' || t.time_str || ':00')::timestamp at time zone p_timezone), 'pending'
  from myday_medications m
  cross join lateral unnest(m.times) as t(time_str)
  cross join lateral (values (local_today - 1), (local_today)) as g(dd)
  where m.active
  on conflict (medication_id, dose_date, scheduled_time) do nothing;

  select coalesce(alert_window_minutes, 60) into win from myday_profiles where user_id = auth.uid();
  update myday_doses set status = 'missed'
   where status = 'pending' and due_at < now() - make_interval(mins => coalesce(win, 60));
end; $$;
grant execute on function myday_refresh_doses(text) to authenticated;

-- Cron-facing (SECURITY DEFINER, all users, each in their own profile timezone + window).
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

  update myday_doses d set status = 'missed'
  from myday_profiles p
  where d.user_id = p.user_id
    and d.status = 'pending'
    and d.due_at < now() - make_interval(mins => coalesce(p.alert_window_minutes, 60));
end; $$;
revoke all on function myday_cron_ensure_and_mark() from public, anon, authenticated;
grant execute on function myday_cron_ensure_and_mark() to service_role;
