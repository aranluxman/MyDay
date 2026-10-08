-- Timing belongs to the receiving device, independently of the patient's
-- missed-dose grace period and the optional daily summary.
alter table public.myday_guardian_devices
  add column alert_mode text not null default 'delay' check (alert_mode in ('delay', 'time')),
  add column alert_delay_minutes integer not null default 60 check (alert_delay_minutes in (15, 30, 45, 60)),
  add column alert_at text not null default '19:00' check (alert_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- A phone may watch several people using the same browser subscription.
-- Uniqueness across all guardians made subscribing to one silence another.
drop index if exists public.myday_guardian_devices_endpoint_uidx;
alter table public.myday_guardian_devices drop constraint if exists myday_guardian_devices_endpoint_key;
create unique index myday_guardian_devices_guardian_endpoint_uidx
  on public.myday_guardian_devices (guardian_id, endpoint);
