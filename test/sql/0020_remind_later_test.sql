-- "Remind me later": only the reminder moves, never the dose.
begin;
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'snooze-a@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'snooze-b@example.test');
insert into myday_profiles (user_id, timezone, alert_window_minutes) values
  ('00000000-0000-0000-0000-0000000000c1', 'UTC', 60), ('00000000-0000-0000-0000-0000000000c2', 'UTC', 60);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into myday_medications (id, name, dose, times) values ('20000000-0000-0000-0000-0000000000c1', 'Synthetic', '1 tablet', '{08:00}');
insert into myday_doses (id, medication_id, dose_date, scheduled_time, due_at, status) values
  ('30000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', current_date, '08:00', now() - interval '5 minutes', 'pending'),
  ('30000000-0000-0000-0000-0000000000c2', '20000000-0000-0000-0000-0000000000c1', current_date, '09:00', now() - interval '55 minutes', 'pending'),
  ('30000000-0000-0000-0000-0000000000c3', '20000000-0000-0000-0000-0000000000c1', current_date, '10:00', now() + interval '3 hours', 'pending'),
  ('30000000-0000-0000-0000-0000000000c4', '20000000-0000-0000-0000-0000000000c1', current_date, '11:00', now() - interval '5 minutes', 'taken');
do $$ declare r jsonb; before myday_doses%rowtype; after myday_doses%rowtype; begin
  select * into before from myday_doses where id = '30000000-0000-0000-0000-0000000000c1';
  r := myday_snooze_dose('30000000-0000-0000-0000-0000000000c1');
  assert r->>'outcome' = 'snoozed', 'a due dose can be postponed: ' || r::text;
  assert (r->>'minutes')::int = 15, 'default snooze length';
  select * into after from myday_doses where id = '30000000-0000-0000-0000-0000000000c1';
  assert after.snoozed_until between now() + interval '14 minutes' and now() + interval '16 minutes', 'reminder comes back in about 15 minutes';
  assert after.due_at = before.due_at and after.status = before.status and after.scheduled_time = before.scheduled_time
    and after.dose_date = before.dose_date, 'the dose itself is unchanged';
  assert (myday_snooze_dose('30000000-0000-0000-0000-0000000000c1', 5)->>'minutes')::int = 5, 'an allowed length can be asked for';
  assert (myday_snooze_dose('30000000-0000-0000-0000-0000000000c1', 240)->>'minutes')::int = 15, 'any other length falls back';
  assert myday_snooze_dose('30000000-0000-0000-0000-0000000000c2')->>'outcome' = 'too_late', 'no reminder is promised after the window closes';
  assert (select snoozed_until is null from myday_doses where id = '30000000-0000-0000-0000-0000000000c2'), 'too_late writes nothing';
  assert myday_snooze_dose('30000000-0000-0000-0000-0000000000c3')->>'outcome' = 'not_due', 'a dose hours away cannot be postponed';
  assert myday_snooze_dose('30000000-0000-0000-0000-0000000000c4')->>'outcome' = 'not_pending', 'a recorded dose has no reminder to postpone';
  assert myday_features()->>'remind_later' in ('true', 'false');
end $$;
-- Another person cannot postpone someone else's reminder.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
do $$ begin
  assert myday_snooze_dose('30000000-0000-0000-0000-0000000000c1')->>'outcome' = 'not_found';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform myday_snooze_dose('30000000-0000-0000-0000-0000000000c1'); assert false, 'anon must not call it';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
