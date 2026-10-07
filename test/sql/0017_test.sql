-- Synthetic fixtures only. Exercises 0017 as a signed-in user under RLS.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test');
insert into myday_profiles (user_id, full_name, timezone) values
  ('00000000-0000-0000-0000-00000000000a', 'Test A', 'America/Toronto'),
  ('00000000-0000-0000-0000-00000000000b', 'Test B', 'UTC');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

-- 1. Exact decimals survive a round trip (0.125 used to become 0.13).
insert into myday_medications (id, name, dose, dose_amount, dose_unit, times, stock_quantity)
values ('10000000-0000-0000-0000-000000000001', 'Synthetic A', '2.75 mg', 2.75, 'mg', '{08:00}', 10),
       ('10000000-0000-0000-0000-000000000002', 'Synthetic B', '0.125 mg', 0.125, 'mg', '{08:00,20:00}', null),
       ('10000000-0000-0000-0000-000000000003', 'Synthetic C', '50 mcg', 50, 'mcg', '{09:00}', null);
do $$ begin
  assert (select dose_amount from myday_medications where name = 'Synthetic B') = 0.125, '0.125 must be stored exactly';
  assert (select dose_amount from myday_medications where name = 'Synthetic A') = 2.75, '2.75 must be stored exactly';
end $$;

-- 2. Invalid amounts are refused at the database too.
do $$ begin
  begin
    insert into myday_medications (name, dose, dose_amount, dose_unit, times) values ('Bad', '-1 ml', -1, 'ml', '{08:00}');
    raise exception 'negative amount was accepted';
  exception when check_violation then null; end;
  begin
    insert into myday_medications (name, dose, dose_amount, dose_unit, times) values ('Bad', '0 ml', 0, 'ml', '{08:00}');
    raise exception 'zero amount was accepted';
  exception when check_violation then null; end;
end $$;

-- 3. Schedule rules at the persistence boundary; PRN is the exception.
do $$ begin
  begin
    insert into myday_medications (name, dose, frequency, times) values ('No time', '1 tablet', 'daily', '{}');
    raise exception 'daily medicine with no time was accepted';
  exception when check_violation then null; end;
  begin
    insert into myday_medications (name, dose, frequency, times, days_of_week) values ('No day', '1 tablet', 'days_of_week', '{08:00}', null);
    raise exception 'certain-days medicine with no day was accepted';
  exception when check_violation then null; end;
  begin
    insert into myday_medications (name, dose, times, start_date, end_date) values ('Inverted', '1 tablet', '{08:00}', '2026-10-10', '2026-10-09');
    raise exception 'end before start was accepted';
  exception when check_violation then null; end;
end $$;
insert into myday_medications (id, name, dose, dose_amount, dose_unit, frequency, times, stock_quantity)
values ('10000000-0000-0000-0000-000000000004', 'Synthetic PRN', '1 tablet', 1, 'tablet', 'as_needed', '{}', 5);

-- 4. Idempotent logging: a double tap is one dose and one decrement.
insert into myday_doses (id, medication_id, dose_date, scheduled_time, due_at)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', current_date, '08:00', now() - interval '10 minutes'),
       ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', current_date + 1, '08:00', now() + interval '1 day');
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb;
begin
  r1 := myday_take_dose('20000000-0000-0000-0000-000000000001');
  r2 := myday_take_dose('20000000-0000-0000-0000-000000000001');
  assert r1->>'outcome' = 'taken', 'first tap records it: ' || r1::text;
  assert r2->>'outcome' = 'already_taken', 'second tap is a no-op: ' || r2::text;
  assert (r2->>'taken_at')::timestamptz = (r1->>'taken_at')::timestamptz, 'taken_at is not overwritten';
  assert (select stock_quantity from myday_medications where name = 'Synthetic A') = 7.25, 'stock decremented exactly once';
  assert (select dose_snapshot from myday_doses where id = '20000000-0000-0000-0000-000000000001') = '2.75 mg', 'snapshot kept';
  r3 := myday_take_dose('20000000-0000-0000-0000-000000000002');
  assert r3->>'outcome' = 'not_due', 'a dose tomorrow cannot be taken today';
end $$;

-- 5. Undo restores exactly; a second undo changes nothing.
do $$
declare r jsonb;
begin
  r := myday_untake_dose('20000000-0000-0000-0000-000000000001');
  assert r->>'outcome' = 'pending', r::text;
  assert (select stock_quantity from myday_medications where name = 'Synthetic A') = 10, 'stock restored';
  r := myday_untake_dose('20000000-0000-0000-0000-000000000001');
  assert r->>'outcome' = 'unchanged', 'undo is idempotent';
  assert (select stock_quantity from myday_medications where name = 'Synthetic A') = 10, 'no double restore';
end $$;

-- 6. Missed and skipped doses never decrement stock.
update myday_doses set status = 'skipped' where id = '20000000-0000-0000-0000-000000000001';
do $$ begin
  assert myday_take_dose('20000000-0000-0000-0000-000000000001')->>'outcome' = 'skipped';
  assert (select stock_quantity from myday_medications where name = 'Synthetic A') = 10;
end $$;
update myday_doses set status = 'missed' where id = '20000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select stock_quantity from myday_medications where name = 'Synthetic A') = 10, 'missed does not decrement';
  -- "I took it late" is still the truth and is recordable.
  assert myday_take_dose('20000000-0000-0000-0000-000000000001', now() - interval '5 minutes')->>'outcome' = 'taken';
end $$;

-- 7. PRN: a retry with the same client id is one dose.
do $$
declare r1 jsonb; r2 jsonb;
begin
  r1 := myday_log_prn_dose('10000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001');
  r2 := myday_log_prn_dose('10000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001');
  assert r1->>'outcome' = 'taken', r1::text;
  assert r2->>'outcome' = 'already_taken', r2::text;
  assert (select count(*) from myday_doses where medication_id = '10000000-0000-0000-0000-000000000004') = 1;
  assert (select stock_quantity from myday_medications where name = 'Synthetic PRN') = 4;
  assert (myday_untake_dose('30000000-0000-0000-0000-000000000001'))->>'outcome' = 'removed';
  assert (select stock_quantity from myday_medications where name = 'Synthetic PRN') = 5;
end $$;

-- 8. Refill adds to stock and is recorded.
do $$ begin
  perform myday_record_refill('10000000-0000-0000-0000-000000000002', 30, null, 'synthetic');
  assert (select stock_quantity from myday_medications where name = 'Synthetic B') = 30, 'unknown stock starts counting';
  assert (select count(*) from myday_refills) = 1;
end $$;

-- 9. Sync after an edit: a removed time's pending dose goes, history stays.
insert into myday_doses (id, medication_id, dose_date, scheduled_time, due_at, status)
values ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', (now() at time zone 'America/Toronto')::date, '20:00', now() + interval '3 hours', 'pending'),
       ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000002', (now() at time zone 'America/Toronto')::date, '08:00', now() - interval '3 hours', 'taken');
update myday_medications set times = '{08:00}' where name = 'Synthetic B';
do $$ begin perform myday_sync_medication_doses('10000000-0000-0000-0000-000000000002', 'America/Toronto'); end $$;
do $$ begin
  assert not exists (select 1 from myday_doses where id = '20000000-0000-0000-0000-000000000010'), 'removed time cleared';
  assert exists (select 1 from myday_doses where id = '20000000-0000-0000-0000-000000000011' and status = 'taken'), 'taken history kept';
end $$;

-- 10. Another user cannot log, undo or see these doses.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert myday_take_dose('20000000-0000-0000-0000-000000000001')->>'outcome' = 'not_found';
  assert myday_untake_dose('20000000-0000-0000-0000-000000000001')->>'outcome' = 'not_found';
  assert (select count(*) from myday_doses) = 0;
end $$;
reset role;
