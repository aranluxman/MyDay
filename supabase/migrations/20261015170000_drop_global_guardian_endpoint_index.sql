-- One phone can watch over more than one person (or be re-invited by the same
-- person with a new code). Its push endpoint is the same every time, so the old
-- "endpoint is unique across ALL guardians" index made the second sign-up fail
-- with "Could not turn on alerts". 20261008163927 meant to drop it, but the
-- live database still had it. Uniqueness per guardian is kept by
-- myday_guardian_devices_guardian_endpoint_uidx (guardian_id, endpoint).
drop index if exists public.myday_guardian_devices_endpoint_uidx;
