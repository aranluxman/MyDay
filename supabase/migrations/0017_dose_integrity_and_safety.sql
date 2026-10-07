-- =====================================================================
-- 0017 — dose integrity, idempotent logging, strength vs amount, inventory,
--        emergency contacts.
--
-- Reversible: see 0017_dose_integrity_and_safety.down.sql. Nothing here
-- rewrites an existing value. Every change either widens a column, adds a
-- nullable column, adds a table, or adds a constraint marked NOT VALID (which
-- applies to new and edited rows only, so no existing record is rejected).
--
-- 1. dose_amount was numeric(10,2). Postgres silently rounds to the column's
--    scale, so 0.125 mg would have been stored as 0.13 mg. Widened to
--    numeric(12,4); every existing value fits unchanged. The app refuses more
--    than four decimals instead of rounding.
-- 2. 'mcg' becomes a real unit instead of being stored as free-text "other".
-- 3. Strength / route / prescribed instructions sit beside the amount taken,
--    so "one 5 mg tablet" can no longer be confused with "5 mg".
-- 4. The schedule rules the app enforces are now enforced on write as well:
--    a scheduled medicine needs a time and "certain days" needs a day.
-- 5. Logging a dose goes through one function that is atomic and idempotent:
--    a double tap, a retry after a lost reply, or a notification button and
--    the app racing each other all produce exactly one 'taken', one taken_at
--    and at most one stock decrement. Undo restores exactly what was taken.
-- 6. Optional inventory and refill history. Stock only ever moves on a
--    confirmed 'taken' (and back on undo) — never for missed or skipped.
-- 7. Contacts gain an emergency flag and a relationship, so a guardian, a
--    pharmacy and an emergency contact are distinguishable. Nothing here
--    alerts anyone automatically.
-- =====================================================================

-- ---------- 1. exact amounts ----------
alter table myday_medications alter column dose_amount type numeric(12, 4);

-- ---------- 2. units ----------
alter table myday_medications drop constraint if exists myday_medications_dose_unit_check;
alter table myday_medications add constraint myday_medications_dose_unit_check
  check (dose_unit is null or dose_unit in
    ('tablet','capsule','ml','drop','puff','mg','mcg','IU','unit','patch','sachet','injection','other'));

-- ---------- 3. strength, route, instructions ----------
alter table myday_medications add column if not exists strength text;
alter table myday_medications add column if not exists route text;
alter table myday_medications add column if not exists instructions text;

do $$ begin
  alter table myday_medications add constraint myday_medications_strength_len
    check (strength is null or char_length(strength) <= 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table myday_medications add constraint myday_medications_route_check
    check (route is null or route in
      ('oral','sublingual','inhaled','eye','ear','nose','skin','injection','rectal','other'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table myday_medications add constraint myday_medications_instructions_len
    check (instructions is null or char_length(instructions) <= 200);
exception when duplicate_object then null; end $$;

-- ---------- 4. schedule rules at the persistence boundary ----------
-- NOT VALID: enforced for every insert and update from now on, without
-- rejecting (or rewriting) any row saved before this migration.
do $$ begin
  alter table myday_medications add constraint myday_medications_times_required
    check (frequency = 'as_needed' or coalesce(array_length(times, 1), 0) > 0) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table myday_medications add constraint myday_medications_days_required
    check (frequency <> 'days_of_week' or coalesce(array_length(days_of_week, 1), 0) > 0) not valid;
exception when duplicate_object then null; end $$;
-- myday_medications_course_check (end >= start) already exists from 0009.

-- ---------- 6. inventory ----------
alter table myday_medications add column if not exists stock_quantity numeric(12, 4);
alter table myday_medications add column if not exists refill_threshold numeric(12, 4);
alter table myday_medications add column if not exists pharmacy_contact_id uuid
  references myday_contacts(id) on delete set null;
alter table myday_medications add column if not exists prescriber_contact_id uuid
  references myday_contacts(id) on delete set null;

do $$ begin
  alter table myday_medications add constraint myday_medications_stock_check
    check ((stock_quantity is null or stock_quantity >= 0)
       and (refill_threshold is null or refill_threshold >= 0));
exception when duplicate_object then null; end $$;

create table if not exists myday_refills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  medication_id uuid not null references myday_medications(id) on delete cascade,
  quantity numeric(12, 4) not null check (quantity > 0 and quantity <= 99999),
  filled_on date not null default current_date,
  note text check (note is null or char_length(note) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists myday_refills_med_idx on myday_refills (medication_id, filled_on desc);
alter table myday_refills enable row level security;
drop policy if exists myday_refills_own on myday_refills;
create policy myday_refills_own on myday_refills for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 5. dose history that survives edits ----------
-- What was actually recorded at the time: the medicine's name and dose then,
-- not whatever they are after a later edit. And how much stock this one
-- confirmed dose used, so undo can put back exactly that.
alter table myday_doses add column if not exists name_snapshot text;
alter table myday_doses add column if not exists dose_snapshot text;
alter table myday_doses add column if not exists stock_used numeric(12, 4);
alter table myday_doses add column if not exists as_needed boolean not null default false;
alter table myday_doses add column if not exists logged_via text;

do $$ begin
  alter table myday_doses add constraint myday_doses_logged_via_check
    check (logged_via is null or logged_via in ('app', 'notification', 'as_needed'));
exception when duplicate_object then null; end $$;

-- ---------- logging a scheduled dose ----------
-- SECURITY INVOKER: for a signed-in caller RLS confines every statement to
-- their own rows. The service role (the notification button) passes p_user.
--
-- Outcomes (jsonb.outcome):
--   taken          this call recorded it
--   already_taken  it was already recorded; nothing changed (idempotent)
--   not_due        too early — tonight's dose cannot be ticked at lunchtime
--   skipped        it was marked "not today"; undo that first
--   not_found      no such dose for this user
create or replace function myday_take_dose(
  p_dose_id uuid, p_taken_at timestamptz default null, p_user uuid default null,
  p_via text default 'app'
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user);
  v_at timestamptz := coalesce(p_taken_at, now());
  d myday_doses%rowtype;
  m myday_medications%rowtype;
  v_used numeric(12, 4);
  v_stock numeric(12, 4);
begin
  if v_user is null then return jsonb_build_object('outcome', 'not_found'); end if;
  -- An actual time can be earlier ("I took it at 8 and forgot to tap"), never later.
  if v_at > now() + interval '2 minutes' then v_at := now(); end if;

  -- The row lock serialises racing taps and devices on this one dose.
  select * into d from myday_doses where id = p_dose_id and user_id = v_user for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if d.status = 'taken' then
    return jsonb_build_object('outcome', 'already_taken', 'taken_at', d.taken_at);
  end if;
  if d.status = 'skipped' then return jsonb_build_object('outcome', 'skipped'); end if;
  if d.due_at > now() + interval '30 minutes' then
    return jsonb_build_object('outcome', 'not_due');
  end if;
  -- Not before the dose's own window opened: that would be a different dose.
  if v_at < d.due_at - interval '12 hours' then v_at := d.due_at - interval '12 hours'; end if;

  select * into m from myday_medications where id = d.medication_id for update;

  -- Stock moves only when it is known and the amount is known. Unknown stock
  -- never blocks logging the dose.
  if m.stock_quantity is not null and m.dose_amount is not null then
    v_used := least(m.dose_amount, m.stock_quantity);
    update myday_medications set stock_quantity = stock_quantity - v_used where id = m.id
      returning stock_quantity into v_stock;
  end if;

  update myday_doses
     set status = 'taken', taken_at = v_at, skipped_at = null, skip_reason = null,
         name_snapshot = m.name, dose_snapshot = m.dose, stock_used = v_used,
         logged_via = case when p_via in ('app', 'notification', 'as_needed') then p_via else 'app' end
   where id = d.id;

  return jsonb_build_object('outcome', 'taken', 'taken_at', v_at, 'stock_quantity', v_stock);
end; $$;
revoke all on function myday_take_dose(uuid, timestamptz, uuid, text) from public, anon;
grant execute on function myday_take_dose(uuid, timestamptz, uuid, text) to authenticated, service_role;

-- Undo / correction: back to pending, and exactly the stock this dose used is
-- returned. Idempotent: undoing a dose that is not taken changes nothing.
create or replace function myday_untake_dose(p_dose_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare d myday_doses%rowtype;
begin
  select * into d from myday_doses where id = p_dose_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if d.status not in ('taken', 'skipped') then return jsonb_build_object('outcome', 'unchanged'); end if;
  if d.stock_used is not null then
    update myday_medications set stock_quantity = coalesce(stock_quantity, 0) + d.stock_used
     where id = d.medication_id and stock_quantity is not null;
  end if;
  if d.as_needed then
    -- An as-needed dose only exists because it was logged; undoing it removes it.
    delete from myday_doses where id = d.id;
    return jsonb_build_object('outcome', 'removed');
  end if;
  update myday_doses set status = 'pending', taken_at = null, skipped_at = null,
         skip_reason = null, stock_used = null, logged_via = null
   where id = d.id;
  return jsonb_build_object('outcome', 'pending');
end; $$;
revoke all on function myday_untake_dose(uuid) from public, anon;
grant execute on function myday_untake_dose(uuid) to authenticated;

-- An as-needed (PRN) dose. p_client_id is generated on the device before the
-- first attempt and reused on every retry, so a retry after a lost reply
-- finds the row it already wrote instead of logging a second dose.
create or replace function myday_log_prn_dose(
  p_medication_id uuid, p_client_id uuid, p_taken_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_at timestamptz := least(coalesce(p_taken_at, now()), now());
  v_tz text;
  m myday_medications%rowtype;
  v_used numeric(12, 4);
  v_id uuid;
  v_stock numeric(12, 4);
begin
  if auth.uid() is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if exists (select 1 from myday_doses where id = p_client_id) then
    return jsonb_build_object('outcome', 'already_taken', 'id', p_client_id);
  end if;
  select * into m from myday_medications where id = p_medication_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select coalesce(timezone, 'UTC') into v_tz from myday_profiles where user_id = auth.uid();
  v_tz := coalesce(v_tz, 'UTC');

  insert into myday_doses (id, user_id, medication_id, dose_date, scheduled_time, due_at, status,
                           taken_at, name_snapshot, dose_snapshot, as_needed, logged_via)
  values (p_client_id, auth.uid(), m.id, (v_at at time zone v_tz)::date,
          to_char(v_at at time zone v_tz, 'HH24:MI'), v_at, 'taken', v_at, m.name, m.dose, true, 'as_needed')
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- Same medicine, same minute: a double tap, not a second dose.
    return jsonb_build_object('outcome', 'already_taken');
  end if;

  if m.stock_quantity is not null and m.dose_amount is not null then
    v_used := least(m.dose_amount, m.stock_quantity);
    update myday_medications set stock_quantity = stock_quantity - v_used where id = m.id
      returning stock_quantity into v_stock;
    update myday_doses set stock_used = v_used where id = v_id;
  end if;
  return jsonb_build_object('outcome', 'taken', 'id', v_id, 'taken_at', v_at, 'stock_quantity', v_stock);
end; $$;
revoke all on function myday_log_prn_dose(uuid, uuid, timestamptz) from public, anon;
grant execute on function myday_log_prn_dose(uuid, uuid, timestamptz) to authenticated;

-- A refill adds to known stock (or starts counting from it).
create or replace function myday_record_refill(
  p_medication_id uuid, p_quantity numeric, p_filled_on date default null, p_note text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_stock numeric(12, 4);
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be more than zero' using errcode = '23514';
  end if;
  insert into myday_refills (medication_id, quantity, filled_on, note)
  values (p_medication_id, p_quantity, coalesce(p_filled_on, current_date), nullif(btrim(p_note), ''));
  update myday_medications set stock_quantity = coalesce(stock_quantity, 0) + p_quantity
   where id = p_medication_id and user_id = auth.uid()
   returning stock_quantity into v_stock;
  return jsonb_build_object('stock_quantity', v_stock);
end; $$;
revoke all on function myday_record_refill(uuid, numeric, date, text) from public, anon;
grant execute on function myday_record_refill(uuid, numeric, date, text) to authenticated;

-- Today's doses follow an edited schedule. Removes only rows that are still
-- pending, were never notified, and are no longer scheduled (a removed time,
-- a removed medicine, a changed day). Taken, missed, skipped and notified rows
-- are history and are never touched. Then regenerates what is now due.
create or replace function myday_sync_medication_doses(p_medication_id uuid, p_timezone text default 'UTC')
returns void language plpgsql security invoker set search_path = public as $$
declare local_today date := (now() at time zone p_timezone)::date;
begin
  delete from myday_doses d
   using myday_medications m
   where d.medication_id = m.id
     and m.id = p_medication_id
     and d.user_id = auth.uid()
     and d.status = 'pending'
     and d.notified = false
     and d.dose_date >= local_today
     and (not m.active
          or not (d.scheduled_time = any(m.times))
          or not myday_dose_due_on(m.frequency, m.days_of_week, m.start_date, m.end_date, d.dose_date));
  perform myday_refresh_doses(p_timezone);
end; $$;
grant execute on function myday_sync_medication_doses(uuid, text) to authenticated;

-- ---------- 7. contacts ----------
alter table myday_contacts add column if not exists relationship text;
alter table myday_contacts add column if not exists is_emergency boolean not null default false;
do $$ begin
  alter table myday_contacts add constraint myday_contacts_relationship_len
    check (relationship is null or char_length(relationship) <= 40);
exception when duplicate_object then null; end $$;
