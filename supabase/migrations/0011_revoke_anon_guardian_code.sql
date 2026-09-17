-- =====================================================================
-- 0011 — stop `anon` being able to call myday_new_guardian_code().
--
-- Found by the Supabase security advisor after 0008-0010 were applied.
-- Migration 0007 created the function and granted EXECUTE to `authenticated`,
-- but Postgres grants EXECUTE to PUBLIC by default on a new function, and 0007
-- never revoked it. So the unauthenticated `anon` role could call it through
-- /rest/v1/rpc/myday_new_guardian_code.
--
-- The leak is small but real and pointless to keep: the function returns a
-- random 6-digit code that is NOT currently in use, so repeated anonymous
-- calls let a caller carve unused values out of the 900k code space and
-- concentrate guessing on what is left. It is also a SECURITY DEFINER function
-- that no anonymous caller has any reason to reach.
--
-- 0008's myday_issue_guardian_code already revokes from public and anon; this
-- brings the older function in line.
-- =====================================================================

revoke all on function myday_new_guardian_code() from public, anon;
grant execute on function myday_new_guardian_code() to authenticated;

-- Same default-PUBLIC-grant reasoning for the pure schedule helper added in
-- 0009. It reads no data, so this is tidiness rather than a leak, but there is
-- no reason for an anonymous caller to have it either.
revoke all on function myday_dose_due_on(text, smallint[], date, date, date) from public, anon;
grant execute on function myday_dose_due_on(text, smallint[], date, date, date) to authenticated, service_role;
