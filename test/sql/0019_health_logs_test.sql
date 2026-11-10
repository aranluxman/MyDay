-- Health tracker and health profile: shapes, ranges and privacy.
-- Fixtures are rolled back so other migration checks stay independent.
begin;
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'health-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'health-b@example.test');
insert into myday_profiles (user_id, timezone) values
  ('00000000-0000-0000-0000-0000000000a1', 'UTC'), ('00000000-0000-0000-0000-0000000000b1', 'UTC');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into myday_health_logs (kind, value, unit) values ('water', 3, 'glass'), ('sleep', 440, 'min'), ('weight', 70.5, 'kg'), ('heart_rate', 72, 'bpm');
insert into myday_health_logs (kind, value, value2, unit) values ('blood_pressure', 128, 82, 'mmHg');

create function pg_temp.rejects(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when check_violation or not_null_violation then return true; end $$;
do $$ begin
  assert pg_temp.rejects($q$insert into myday_health_logs (kind, value, unit) values ('blood_pressure', 128, 'mmHg')$q$), 'blood pressure needs both numbers';
  assert pg_temp.rejects($q$insert into myday_health_logs (kind, value, value2, unit) values ('blood_pressure', 80, 120, 'mmHg')$q$), 'systolic must be the larger number';
  assert pg_temp.rejects($q$insert into myday_health_logs (kind, value, unit) values ('heart_rate', 900, 'bpm')$q$), 'a pulse of 900 is a typing mistake';
  assert pg_temp.rejects($q$insert into myday_health_logs (kind, value, unit) values ('sleep', 2000, 'min')$q$), 'no more than 24 hours of sleep';
  assert pg_temp.rejects($q$insert into myday_health_logs (kind, value, unit) values ('water', 3, 'kg')$q$), 'unit must fit the kind';
  assert pg_temp.rejects($q$insert into myday_health_logs (kind, value, unit) values ('steps', 3, 'steps')$q$), 'unknown kinds are refused';
  assert pg_temp.rejects($q$insert into myday_health_logs (kind, value, unit, logged_at) values ('water', 1, 'glass', now() + interval '3 days')$q$), 'no readings from the future';
  assert pg_temp.rejects($q$update myday_profiles set allergies_none = true, allergies = 'Penicillin' where user_id = auth.uid()$q$), 'no known allergies and a list cannot both be set';
  assert pg_temp.rejects($q$update myday_profiles set height_cm = 900 where user_id = auth.uid()$q$), 'height range';
  assert pg_temp.rejects($q$update myday_profiles set gender = 'robot' where user_id = auth.uid()$q$), 'gender options';
end $$;
update myday_profiles set gender = 'woman', height_cm = 165, weight_kg = 61.5, allergies_none = true where user_id = auth.uid();
update myday_profiles set allergies_none = false, allergies = 'Penicillin', conditions = 'Synthetic condition' where user_id = auth.uid();

-- Another person sees none of it and cannot write into it.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ declare n int; begin
  assert (select count(*) from myday_health_logs) = 0, 'health logs are private to their owner';
  update myday_health_logs set value = 1 where true;
  get diagnostics n = row_count;
  assert n = 0, 'another person cannot change a reading';
  delete from myday_health_logs where true;
  get diagnostics n = row_count;
  assert n = 0, 'another person cannot delete a reading';
  begin
    insert into myday_health_logs (user_id, kind, value, unit) values ('00000000-0000-0000-0000-0000000000a1', 'water', 1, 'glass');
    assert false, 'must not insert a reading for someone else';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin assert (select count(*) from myday_health_logs) = 5, 'the owner still has all five readings'; end $$;

-- Signed-out visitors get nothing.
reset role;
set local role anon;
do $$ begin
  begin perform count(*) from myday_health_logs; assert false, 'anon must not read health logs';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
