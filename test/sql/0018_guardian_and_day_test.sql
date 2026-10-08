-- Regression coverage for dose regeneration and guardian timing/subscriptions.
-- Isolated fixtures are rolled back so other migration checks stay independent.
begin;
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000018', 'guardian-day@example.test');
insert into myday_profiles (user_id, timezone) values ('00000000-0000-0000-0000-000000000018', 'UTC');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000018';
insert into myday_medications (id, name, dose, times) values
 ('10000000-0000-0000-0000-000000000018', 'Twice daily', '1 tablet', '{08:00,20:00}'),
 ('10000000-0000-0000-0000-000000000019', 'Once daily', '1 tablet', '{08:00}');
select myday_refresh_doses('UTC');
update myday_doses set due_at = now() - interval '1 hour'
 where medication_id in ('10000000-0000-0000-0000-000000000018','10000000-0000-0000-0000-000000000019')
 and dose_date = current_date and scheduled_time = '08:00';
do $$ declare d record; at timestamptz; begin
 for d in select id from myday_doses where medication_id in ('10000000-0000-0000-0000-000000000018','10000000-0000-0000-0000-000000000019')
  and dose_date = current_date and scheduled_time = '08:00' loop
  assert myday_take_dose(d.id)->>'outcome' = 'taken';
  select taken_at into at from myday_doses where id = d.id;
  perform myday_refresh_doses('UTC');
  perform myday_refresh_doses('UTC');
  assert (select status = 'taken' and taken_at = at from myday_doses where id = d.id), 'refresh must retain completed morning doses';
 end loop;
 assert (select count(*) from myday_doses where medication_id = '10000000-0000-0000-0000-000000000018' and dose_date = current_date) = 2, 'two scheduled doses remain distinct';
 assert (select count(*) from myday_doses where medication_id = '10000000-0000-0000-0000-000000000019' and dose_date = current_date) = 1, 'once-daily medicine must never gain an evening dose';
end $$;
reset role;
select myday_cron_ensure_and_mark();
do $$ begin
 assert (select bool_and(status = 'taken') from myday_doses where user_id = '00000000-0000-0000-0000-000000000018'
  and dose_date = current_date and scheduled_time = '08:00'), 'cron must retain taken mornings';
end $$;
insert into myday_guardians (id, user_id, name) values
 ('30000000-0000-0000-0000-000000000018','00000000-0000-0000-0000-000000000018','Guardian A'),
 ('30000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000018','Guardian B');
insert into myday_guardian_devices (guardian_id, endpoint, subscription, alert_delay_minutes) values
 ('30000000-0000-0000-0000-000000000018','https://push.example.test/shared','{}',15),
 ('30000000-0000-0000-0000-000000000019','https://push.example.test/shared','{}',45);
do $$ begin
 assert (select count(*) from myday_guardian_devices where endpoint = 'https://push.example.test/shared') = 2, 'one phone can watch multiple people';
 begin
  update myday_guardian_devices set alert_delay_minutes = 17 where endpoint = 'https://push.example.test/shared';
  raise exception 'invalid delay accepted';
 exception when check_violation then null; end;
 begin
  update myday_guardian_devices set alert_at = '25:00' where endpoint = 'https://push.example.test/shared';
  raise exception 'invalid time accepted';
 exception when check_violation then null; end;
end $$;
rollback;
