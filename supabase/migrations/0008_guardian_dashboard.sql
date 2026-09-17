-- =====================================================================
-- 0008 — the guardian dashboard (Part A).
--
-- Until now a guardian typed a 6-digit code, got web-push alerts, and had
-- nowhere to go: no page, no sign that anything had been saved. This gives
-- them a persistent, READ-ONLY dashboard at /guardian, remembered on their
-- device, without an account.
--
-- The security model, because it is the whole point of this file:
--
--   * Linking uses the short 6-digit code. A 6-digit code is guessable, so it
--     is now SINGLE-USE and lives for 15 MINUTES (was: reusable for 14 days).
--     Guessing is already throttled by myday_join_rate_limited from 0007.
--   * Returning uses a 256-bit device token, minted at link time. Only its
--     SHA-256 hash is stored here; the plaintext exists in the guardian's
--     localStorage and in the request body, never in this database. A dump of
--     these tables therefore does not let anyone read a senior's data.
--   * NO ANON RLS POLICY IS ADDED TO ANY HEALTH TABLE. Guardian reads go
--     through the `guardian-data` edge function (service role), which resolves
--     a token hash to exactly one user_id and returns only that senior's rows.
--     Read-only is structural: the function has no write path to senior data.
--   * The senior can revoke a device or a whole guardian at any time, which
--     takes effect on the very next request.
--
-- Health data stays opt-in: a guardian sees medications, doses and
-- appointments, and sees diary notes only if the senior turns that on.
-- =====================================================================

-- ---------- guardians: short-lived single-use codes + audit ----------
alter table myday_guardians add column if not exists code_expires_at timestamptz;
alter table myday_guardians add column if not exists code_used_at timestamptz;
alter table myday_guardians add column if not exists last_dashboard_at timestamptz;
-- Diary notes are more personal than a dose list, so they are never shared
-- unless the senior explicitly says so.
alter table myday_guardians add column if not exists share_diary boolean not null default false;

-- Mints a code and its 15-minute expiry together, so the two can never drift
-- apart. SECURITY DEFINER for the same reason as myday_new_guardian_code: the
-- uniqueness probe has to see rows belonging to other users, and it returns
-- nothing but a random number.
create or replace function myday_issue_guardian_code(p_guardian_id uuid)
returns table (code text, code_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_code text; v_exp timestamptz;
begin
  -- Scope the write to the caller: without this check a signed-in user could
  -- mint a code onto somebody else's guardian row, since DEFINER skips RLS.
  if not exists (select 1 from myday_guardians g where g.id = p_guardian_id and g.user_id = auth.uid()) then
    raise exception 'not your guardian';
  end if;

  v_code := myday_new_guardian_code();
  v_exp := now() + interval '15 minutes';

  update myday_guardians
     set code = v_code, code_expires_at = v_exp, code_used_at = null
   where id = p_guardian_id;

  return query select v_code, v_exp;
end $$;
revoke all on function myday_issue_guardian_code(uuid) from public, anon;
grant execute on function myday_issue_guardian_code(uuid) to authenticated;

-- Existing rows predate the short window. Their codes were mintable for 14
-- days, so treat them as already spent rather than silently long-lived: the
-- senior taps "Show code" and gets a fresh 15-minute one.
update myday_guardians
   set code_expires_at = coalesce(code_expires_at, created_at)
 where code_expires_at is null;

-- ---------- guardian devices: long-lived hashed tokens ----------
-- token_hash is hex SHA-256 of the device token. The edge function hashes the
-- incoming token and looks it up; the plaintext is never stored or logged.
alter table myday_guardian_devices add column if not exists token_hash text;
alter table myday_guardian_devices add column if not exists label text;
alter table myday_guardian_devices add column if not exists platform text;
alter table myday_guardian_devices add column if not exists last_seen_at timestamptz;
alter table myday_guardian_devices add column if not exists revoked_at timestamptz;
alter table myday_guardian_devices add column if not exists push_enabled boolean not null default false;
-- 'HH:MM' in the senior's timezone, or null for no daily summary.
alter table myday_guardian_devices add column if not exists daily_summary_at text;
alter table myday_guardian_devices add column if not exists last_delivered_at timestamptz;
alter table myday_guardian_devices add column if not exists last_error text;
alter table myday_guardian_devices add column if not exists created_ip_key text;

create unique index if not exists myday_guardian_devices_token_uidx
  on myday_guardian_devices (token_hash) where token_hash is not null;
create index if not exists myday_guardian_devices_live_idx
  on myday_guardian_devices (guardian_id) where revoked_at is null;

-- A device row used to exist only to hold a push subscription, so `endpoint`
-- was NOT NULL and UNIQUE. A dashboard device may have no push subscription at
-- all (alerts are optional, and iOS refuses them until installed), so endpoint
-- has to become nullable — while staying unique among the rows that have one.
alter table myday_guardian_devices alter column endpoint drop not null;
alter table myday_guardian_devices alter column subscription drop not null;
do $$ begin
  alter table myday_guardian_devices drop constraint myday_guardian_devices_endpoint_key;
exception when undefined_object then null; end $$;
create unique index if not exists myday_guardian_devices_endpoint_uidx
  on myday_guardian_devices (endpoint) where endpoint is not null;

-- Existing push-only rows have no token, so the guardian's device is not
-- remembered yet; they re-link once with a code and keep their subscription
-- (the upsert in the edge function matches on endpoint).

-- Any device row the patient can already see through the parent guardian row
-- stays visible: the 0006 policies are unchanged and still cover the new
-- columns. Guardian-side access remains service-role only.

-- ---------- revocation ----------
-- Revoking is a senior-side action, so it runs under the caller's own RLS
-- rather than as DEFINER. Setting revoked_at is what kills the token: the edge
-- function filters on it, so the next dashboard request fails immediately.
create or replace function myday_revoke_guardian_device(p_device_id uuid)
returns void language sql security invoker set search_path = public as $$
  update myday_guardian_devices d
     set revoked_at = now(), push_enabled = false
   where d.id = p_device_id
     and exists (select 1 from myday_guardians g where g.id = d.guardian_id and g.user_id = auth.uid());
$$;
grant execute on function myday_revoke_guardian_device(uuid) to authenticated;

-- ---------- what the guardian function is allowed to read ----------
-- Documented here rather than enforced here, because the enforcement lives in
-- the edge function: it selects from myday_medications, myday_doses,
-- myday_appointments, myday_contacts (name/phone only) and — when
-- share_diary is true — myday_diary, in every case filtered to the single
-- user_id resolved from the device token. It performs no writes against any
-- senior-owned table; its only writes are last_seen_at / last_dashboard_at on
-- the guardian's own rows.
