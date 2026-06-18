-- Dose generation + missed-marking. Timezone logic lives here so the browser and
-- the cron Edge Function stay in agreement. SECURITY INVOKER: the caller (anon via
-- RLS policy, or the cron's service role) already has the needed table access.

-- Generate pending dose rows for one local date for every active medication,
-- computing each absolute due_at from 'HH:MM' interpreted in the patient timezone.
create or replace function myday_ensure_doses_for_date(p_date date, p_timezone text default 'UTC')
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into myday_doses (patient_id, medication_id, dose_date, scheduled_time, due_at, status)
  select m.patient_id, m.id, p_date, t.time_str,
         ((p_date::text || ' ' || t.time_str || ':00')::timestamp at time zone p_timezone),
         'pending'
  from myday_medications m
  cross join lateral unnest(m.times) as t(time_str)
  where m.active = true
  on conflict (medication_id, dose_date, scheduled_time) do nothing;
end;
$$;

-- Ensure yesterday's + today's doses exist, then flip any dose still pending more
-- than 1 hour past its due time to 'missed'. (Notifications are sent by the Edge
-- Function, not here.) Called by the client on load and by the cron each run.
create or replace function myday_refresh_doses(p_timezone text default 'UTC')
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  local_today date := (now() at time zone p_timezone)::date;
begin
  perform myday_ensure_doses_for_date(local_today - 1, p_timezone);
  perform myday_ensure_doses_for_date(local_today, p_timezone);
  update myday_doses
  set status = 'missed'
  where status = 'pending' and due_at < now() - interval '1 hour';
end;
$$;

grant execute on function myday_ensure_doses_for_date(date, text) to anon, authenticated, service_role;
grant execute on function myday_refresh_doses(text) to anon, authenticated, service_role;
