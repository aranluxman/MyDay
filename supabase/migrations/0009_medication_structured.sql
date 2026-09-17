-- =====================================================================
-- 0009 — structured medications and real schedules (Part C).
--
-- Two problems this fixes.
--
-- 1. The dose was a free-text box. That is how a medicine ends up saved as
--    "dafs". A dose is an amount and a unit, so those become columns.
--    myday_medications.dose STAYS as the display string ("1 tablet",
--    "1000 IU") so every existing screen, the guardian dashboard and the push
--    notification bodies keep working untouched.
--
-- 2. Every medicine was implicitly "every day". A ten-day course of
--    antibiotics, a Monday/Thursday tablet and an as-needed painkiller were
--    all stored the same way, so the generator produced dose rows that were
--    never really scheduled and the cron then marked them MISSED — phantom
--    missed-dose alerts for medicines nobody was supposed to take that day.
--    Dose generation now honours frequency, chosen weekdays, a start date and
--    an end date, and never generates anything for an as-needed medicine.
--
-- On migrating existing data: this file does NOT rewrite anybody's dose text.
-- It fills the new structured columns only where a conservative regex is
-- certain, and leaves them NULL otherwise. Unparseable text ("dafs") is left
-- exactly as it is, and the edit flow asks the person rather than guessing.
-- Guessing someone's dose is far worse than admitting we cannot read it.
-- =====================================================================

-- ---------- structured dose + schedule ----------
alter table myday_medications add column if not exists dose_amount numeric(10, 2);
alter table myday_medications add column if not exists dose_unit text;
alter table myday_medications add column if not exists dose_other text;

alter table myday_medications add column if not exists frequency text not null default 'daily';
-- 0 = Sunday … 6 = Saturday, matching the Sunday-first calendar.
alter table myday_medications add column if not exists days_of_week smallint[];
alter table myday_medications add column if not exists start_date date;
alter table myday_medications add column if not exists end_date date;
alter table myday_medications add column if not exists with_food boolean not null default false;
alter table myday_medications add column if not exists photo_path text;
-- Per-medicine reminder overrides (Part E).
alter table myday_medications add column if not exists reminders_enabled boolean not null default true;
alter table myday_medications add column if not exists alert_window_override integer;

do $$ begin
  alter table myday_medications add constraint myday_medications_frequency_check
    check (frequency in ('daily', 'days_of_week', 'alternate', 'as_needed'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table myday_medications add constraint myday_medications_dose_amount_check
    check (dose_amount is null or (dose_amount > 0 and dose_amount <= 9999));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table myday_medications add constraint myday_medications_dose_unit_check
    check (dose_unit is null or dose_unit in
      ('tablet','capsule','ml','drop','puff','mg','IU','unit','patch','sachet','injection','other'));
exception when duplicate_object then null; end $$;

-- A weekday list is only meaningful for 'days_of_week', and every entry has to
-- be a real day. A bad value here would silently drop doses.
do $$ begin
  alter table myday_medications add constraint myday_medications_dow_check
    check (days_of_week is null or (
      array_length(days_of_week, 1) between 1 and 7
      and not exists (select 1 from unnest(days_of_week) d where d < 0 or d > 6)
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table myday_medications add constraint myday_medications_course_check
    check (start_date is null or end_date is null or end_date >= start_date);
exception when duplicate_object then null; end $$;

-- ---------- backfill, conservatively ----------
-- Only the unambiguous "<number> <known unit>" shapes, and only where the
-- structured columns are still empty. Anything else stays NULL and is handled
-- by the well-tested JS parser when the person next edits the medicine.
with parsed as (
  select
    m.id,
    -- Leading amount: "1", "0.5", ".5" or "1/2".
    (regexp_match(btrim(m.dose), '^(\d+\s*/\s*\d+|\d*\.\d+|\d+)\s*(.*)$'))[1] as amount_tok,
    lower(btrim((regexp_match(btrim(m.dose), '^(\d+\s*/\s*\d+|\d*\.\d+|\d+)\s*(.*)$'))[2])) as unit_tok
  from myday_medications m
  where m.dose is not null and btrim(m.dose) <> '' and m.dose_amount is null
),
mapped as (
  select
    p.id,
    case
      when p.amount_tok ~ '^\d+\s*/\s*\d+$'
        then (split_part(replace(p.amount_tok, ' ', ''), '/', 1))::numeric
           / nullif((split_part(replace(p.amount_tok, ' ', ''), '/', 2))::numeric, 0)
      else p.amount_tok::numeric
    end as amount,
    case p.unit_tok
      when 'tablet' then 'tablet' when 'tablets' then 'tablet'
      when 'tab' then 'tablet'    when 'tabs' then 'tablet'
      when 'pill' then 'tablet'   when 'pills' then 'tablet'
      when 'capsule' then 'capsule' when 'capsules' then 'capsule'
      when 'cap' then 'capsule'   when 'caps' then 'capsule'
      when 'ml' then 'ml'         when 'mls' then 'ml'
      when 'drop' then 'drop'     when 'drops' then 'drop'
      when 'puff' then 'puff'     when 'puffs' then 'puff'
      when 'mg' then 'mg'         when 'mgs' then 'mg'
      when 'iu' then 'IU'
      when 'unit' then 'unit'     when 'units' then 'unit'
      when 'patch' then 'patch'   when 'patches' then 'patch'
      when 'sachet' then 'sachet' when 'sachets' then 'sachet'
      when 'injection' then 'injection' when 'injections' then 'injection'
      else null
    end as unit
  from parsed p
)
update myday_medications m
   set dose_amount = mapped.amount, dose_unit = mapped.unit
  from mapped
 where m.id = mapped.id
   and mapped.unit is not null
   and mapped.amount is not null
   and mapped.amount > 0
   and mapped.amount <= 9999;

-- ---------- is a medicine due on a given day? ----------
-- The SQL twin of isDueOn() in src/lib/schedule.js. Both are covered by the
-- same cases (see test/schedule.test.js) because a disagreement between them
-- shows up as a phantom missed dose.
create or replace function myday_dose_due_on(
  p_frequency text, p_days smallint[], p_start date, p_end date, p_day date
) returns boolean language sql immutable set search_path = public as $$
  select case
    -- As-needed medicines are never scheduled, so they can never be missed.
    when coalesce(p_frequency, 'daily') = 'as_needed' then false
    when p_start is not null and p_day < p_start then false
    when p_end is not null and p_day > p_end then false
    when coalesce(p_frequency, 'daily') = 'days_of_week' then
      -- An empty day list is an incomplete schedule, not "every day".
      coalesce(array_length(p_days, 1), 0) > 0
      and extract(dow from p_day)::smallint = any(p_days)
    when coalesce(p_frequency, 'daily') = 'alternate' then
      -- Anchored to the start date so the phase cannot drift between runs.
      (p_day - coalesce(p_start, p_day)) % 2 = 0
    else true
  end;
$$;
grant execute on function myday_dose_due_on(text, smallint[], date, date, date) to authenticated, service_role;

-- ---------- dose generation, schedule-aware ----------
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
    and myday_dose_due_on(m.frequency, m.days_of_week, m.start_date, m.end_date, g.dd)
  on conflict (medication_id, dose_date, scheduled_time) do nothing;

  select coalesce(alert_window_minutes, 60) into win from myday_profiles where user_id = auth.uid();

  -- A per-medicine window overrides the profile default, so a medicine the
  -- person has given a longer grace period is not marked missed early.
  update myday_doses d set status = 'missed'
   from myday_medications m
  where d.medication_id = m.id
    and d.status = 'pending'
    and m.reminders_enabled
    and d.due_at < now() - make_interval(mins => coalesce(m.alert_window_override, win, 60));
end; $$;
grant execute on function myday_refresh_doses(text) to authenticated;

-- Cron-facing (SECURITY DEFINER, all users, each in their own timezone).
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
    and myday_dose_due_on(m.frequency, m.days_of_week, m.start_date, m.end_date, g.dd)
  on conflict (medication_id, dose_date, scheduled_time) do nothing;

  update myday_doses d set status = 'missed'
  from myday_profiles p, myday_medications m
  where d.user_id = p.user_id
    and d.medication_id = m.id
    and d.status = 'pending'
    -- A medicine with reminders switched off still tracks doses, but it is not
    -- flipped to missed and never triggers an alert.
    and m.reminders_enabled
    and d.due_at < now() - make_interval(
      mins => coalesce(m.alert_window_override, p.alert_window_minutes, 60));
end; $$;
revoke all on function myday_cron_ensure_and_mark() from public, anon, authenticated;
grant execute on function myday_cron_ensure_and_mark() to service_role;

-- ---------- clean up doses that should never have existed ----------
-- Pending, untaken, un-notified future/other-day doses belonging to medicines
-- that are not actually due then. Scoped hard: anything taken, already marked
-- missed, or already notified is left alone, so no history is rewritten and no
-- alert is un-sent.
delete from myday_doses d
 using myday_medications m
 where d.medication_id = m.id
   and d.status = 'pending'
   and d.taken_at is null
   and d.notified = false
   and not myday_dose_due_on(m.frequency, m.days_of_week, m.start_date, m.end_date, d.dose_date);

-- ---------- pill / box photos ----------
-- Private bucket: a photo of a medicine box is health data, so unlike
-- myday-avatars (which is public) this is served only via signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('myday-med-photos', 'myday-med-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists myday_med_photos_read on storage.objects;
drop policy if exists myday_med_photos_insert on storage.objects;
drop policy if exists myday_med_photos_update on storage.objects;
drop policy if exists myday_med_photos_delete on storage.objects;

-- Every policy is scoped to the user's own top-level folder, so one signed-in
-- user can never read or write another's photos.
create policy myday_med_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'myday-med-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy myday_med_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'myday-med-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy myday_med_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'myday-med-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'myday-med-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy myday_med_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'myday-med-photos' and (storage.foldername(name))[1] = auth.uid()::text);
