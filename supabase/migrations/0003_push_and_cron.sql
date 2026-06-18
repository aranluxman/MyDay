-- Web-push config + the cron that drives the missed-dose Edge Function.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Server-only secrets (VAPID keypair). RLS is ON with NO policy, so the browser's
-- publishable (anon) key can never read this table; only the service role (used by
-- the Edge Function) bypasses RLS. The actual keys are inserted out-of-band and are
-- intentionally NOT committed to this repo:
--
--   insert into myday_push_config (id, vapid_public, vapid_private, contact)
--   values (1, '<VAPID public>', '<VAPID private>', 'mailto:you@example.com');
--
-- Generate a keypair with:  npx web-push generate-vapid-keys
-- (the public key also goes into public/config.js as VAPID_PUBLIC_KEY).
create table if not exists myday_push_config (
  id            int primary key default 1,
  vapid_public  text not null,
  vapid_private text not null,
  contact       text not null default 'mailto:admin@example.com',
  updated_at    timestamptz not null default now(),
  constraint myday_push_config_singleton check (id = 1)
);
alter table myday_push_config enable row level security;
-- (no policies on purpose -> anon/authenticated denied; service_role bypasses)

-- Run the missed-dose check every 5 minutes.
-- (Re)create the schedule safely.
do $$
begin
  perform cron.unschedule('myday-missed-dose-check');
exception when others then null;
end $$;

select cron.schedule(
  'myday-missed-dose-check',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url     := 'https://hcvjiveloioftozvnbhe.supabase.co/functions/v1/missed-dose-check',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $job$
);
