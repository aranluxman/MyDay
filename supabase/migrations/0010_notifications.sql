-- =====================================================================
-- 0010 — real notifications, with user control (Part E).
--
-- Three things this adds:
--
-- 1. myday_notification_prefs — one row per user holding every switch the
--    notification settings screen offers. Per-user RLS like everything else.
--
-- 2. myday_notification_log — what has already been delivered, so the same
--    alert is not sent twice across a phone, a tablet and an installed PWA.
--    The key includes an attempt number, so a deliberate repeat is not
--    swallowed as a duplicate (see dedupeKey in src/lib/notifications.js).
--
-- 3. myday_dose_action_tokens — this is the interesting one. The "I took it"
--    button on a notification has to mark the dose WITHOUT opening the app,
--    and a service worker has no Supabase session: it cannot read
--    localStorage, and we are certainly not putting a long-lived credential
--    in a push payload. So each dose notification carries a single-use token
--    that can do exactly one thing — mark that one dose taken — and expires.
--    Only its hash is stored, so the table is not a set of usable keys.
-- =====================================================================

-- ---------- preferences ----------
create table if not exists myday_notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),

  master boolean not null default true,
  dose_due boolean not null default true,
  dose_missed boolean not null default true,
  appointment boolean not null default true,
  daily_summary boolean not null default false,
  game_nudge boolean not null default false,
  guardian_alert boolean not null default true,

  appointment_lead_minutes integer not null default 120,
  daily_summary_at text not null default '09:00',

  -- 0 = do not repeat.
  repeat_every_minutes integer not null default 0,
  repeat_max_times integer not null default 2,
  snooze_minutes integer not null default 15,

  quiet_hours_enabled boolean not null default false,
  quiet_from text not null default '21:00',
  quiet_to text not null default '07:00',

  sound boolean not null default true,
  vibrate boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 'HH:MM', 24-hour. A malformed value here would break quiet-hours maths
  -- and could silence a missed-dose alert, so it is constrained.
  constraint myday_np_summary_at_fmt check (daily_summary_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint myday_np_quiet_from_fmt check (quiet_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint myday_np_quiet_to_fmt check (quiet_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint myday_np_lead check (appointment_lead_minutes in (30, 120, 1440)),
  constraint myday_np_repeat_every check (repeat_every_minutes in (0, 5, 10, 15, 30)),
  constraint myday_np_repeat_max check (repeat_max_times between 0 and 5),
  constraint myday_np_snooze check (snooze_minutes in (5, 10, 15, 30))
);

create trigger t_myday_np_u before update on myday_notification_prefs
  for each row execute function myday_set_updated_at();

alter table myday_notification_prefs enable row level security;
create policy myday_notification_prefs_own on myday_notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- delivery log (de-duplication) ----------
create table if not exists myday_notification_log (
  key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  ref_id text,
  delivered_at timestamptz not null default now(),
  device_count integer not null default 0,
  error text
);
create index if not exists myday_notification_log_user_idx
  on myday_notification_log (user_id, delivered_at desc);

alter table myday_notification_log enable row level security;
-- Read-only for the owner: the settings screen shows "last delivered" per
-- device. Only the service role writes, because only it sends.
create policy myday_notification_log_read on myday_notification_log for select to authenticated
  using (user_id = auth.uid());

-- Housekeeping: the log is a de-duplication window, not an archive.
create or replace function myday_prune_notification_log()
returns void language sql security definer set search_path = public as $$
  delete from myday_notification_log where delivered_at < now() - interval '30 days';
$$;
revoke all on function myday_prune_notification_log() from public, anon, authenticated;
grant execute on function myday_prune_notification_log() to service_role;

-- ---------- single-use dose action tokens ----------
-- One token marks one dose taken, once, and then is spent. Only the SHA-256
-- hash is stored: a dump of this table cannot be replayed against anyone.
create table if not exists myday_dose_action_tokens (
  token_hash text primary key,
  dose_id uuid not null references myday_doses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists myday_dose_action_tokens_dose_idx on myday_dose_action_tokens (dose_id);

alter table myday_dose_action_tokens enable row level security;
-- RLS on with NO policy: the browser has no business reading these at all.
-- Only the service role (the sending function and the action endpoint) can.

create or replace function myday_prune_dose_action_tokens()
returns void language sql security definer set search_path = public as $$
  delete from myday_dose_action_tokens where expires_at < now() - interval '2 days';
$$;
revoke all on function myday_prune_dose_action_tokens() from public, anon, authenticated;
grant execute on function myday_prune_dose_action_tokens() to service_role;

-- ---------- per-device delivery visibility ----------
-- So the settings screen can show a real per-device list with last-delivered
-- status, instead of the person having no way to tell why nothing arrived.
alter table myday_family_devices add column if not exists platform text;
alter table myday_family_devices add column if not exists installed boolean;
alter table myday_family_devices add column if not exists last_error text;
alter table myday_family_devices add column if not exists last_delivered_at timestamptz;
alter table myday_family_devices add column if not exists push_enabled boolean not null default true;

-- ---------- make a prefs row for everyone who already has an account ----------
-- Defaults match PREF_DEFAULTS, and dose reminders default ON because a
-- medication app that reminds nobody by default is not doing its job.
insert into myday_notification_prefs (user_id)
select user_id from myday_profiles
on conflict (user_id) do nothing;

-- ---------- cron: reminders every 5 minutes ----------
-- Separate from the missed-dose cron so a failure in one cannot delay the
-- other. Missed-dose detection stays exactly as it was.
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('myday-send-reminders'); exception when others then null; end $$;
select cron.schedule('myday-send-reminders', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://zciulgqkqusjxomyapcz.supabase.co/functions/v1/send-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$job$);

do $$ begin perform cron.unschedule('myday-prune-notification-log'); exception when others then null; end $$;
select cron.schedule('myday-prune-notification-log', '17 4 * * *', $job$
  select myday_prune_notification_log(); select myday_prune_dose_action_tokens();
$job$);
