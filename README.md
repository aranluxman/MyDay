# MyDay

A calm, mobile-first web app that helps one elderly person with mild dementia keep
track of **medications**, **appointments**, and **brain games** — used by the
patient himself, with a family member able to help and to be alerted if a dose is
missed.

It is a **PWA** (add it to the phone's Home Screen — no app store), built with
**React in plain JavaScript with no build step** (React + [htm](https://github.com/developit/htm)
loaded from a CDN), backed by **Supabase** (Postgres + Edge Functions + cron),
and deployable to **Cloudflare Pages**.

> **No build step.** React and htm are imported from a CDN at runtime, so the app
> is still just static files — open `public/index.html` over http, or deploy the
> `public/` folder to Cloudflare Pages as-is. There is nothing to compile.

---

## Design for seniors

- Large text, high contrast, generous spacing, no clutter.
- Big tap targets — every button is at least 60px tall; the main menu buttons are
  large cards.
- No emojis. Plain, reassuring language and gentle encouragement.
- A simple Home screen: three large buttons (**My Medications**, **My
  Appointments**, **Brain Games**) plus today's medication status at a glance.

---

## Features

### 1. Medication tracker
- Supports 1–3 medications, each on a fixed daily schedule (e.g. 9 AM, 8 PM).
- Each medicine stores name, dose, one or more daily times, and an optional note
  ("take with food").
- The app generates a **dose** row for every scheduled time each day. A dose is
  `pending`, `taken`, or `missed`.
- When a dose is due it shows a clear reminder (name, dose, note) with one big
  **"Done – I took it"** button that records the time.
- A dose left unconfirmed for more than **1 hour** after it was due is marked
  `missed` (by both the app on open and the server cron).
- Patient and family can add / edit / remove medicines (removing is a soft delete
  so past history stays intact).

### 2. Missed-dose push notification
- When a dose becomes `missed`, a **web-push** notification goes to every family
  device that has turned on alerts, e.g. *"Dad has not taken his 9:00 AM
  medication."*
- A Supabase **Edge Function** (`missed-dose-check`) runs on a **cron every 5
  minutes**: it ensures dose rows exist, flips overdue `pending` doses to `missed`,
  and sends the alerts. Each missed dose is only alerted once.

### 3. Appointment tracker
- Each appointment stores date, time, doctor, location, and reason.
- Upcoming appointments are shown in a large-text list, soonest first.
- Patient and family can add / edit / remove appointments.

### 4. Brain games
- A mix of game types:
  - **Match the Pairs** — flip-card memory game with word pairs.
  - **Word Puzzle** — fill in the missing word of a familiar saying.
  - **Number Patterns** — find the next number in a sequence.
  - **Today (orientation prompts)** — gentle grounding questions ("What day is it
    today?", "What season is it?") with kind confirmation.
- Unlimited play. **Difficulty adapts**: it nudges up after good rounds and down
  after harder ones (resume level kept per game on the device; full history in the
  database).
- Gentle encouragement on success ("Great job!").
- Every result is saved to Supabase, and a **Progress** view shows recent trends.
- The Home screen gives a gentle nudge to play **only if** no game has been played
  that day.

---

## Architecture

```
public/                 -> static site (deploy this folder to Cloudflare Pages)
  index.html            -> app shell with the #root mount point
  main.js               -> mounts React + registers the service worker
  react.js              -> single React/htm setup (one React instance, class+style shims)
  app.js                -> App root: providers, hash router, app bar, transitions
  ui.js                 -> design-system components, icons, toast/confirm/prompt, hooks
  home.js               -> Home: today's status + the three big menu buttons
  meds.js               -> today's doses, the Done tap, add/edit/remove medicines
  appts.js              -> appointments: upcoming list + add/edit/remove
  games.js / gamedata.js-> the four games (UI / pure logic) + adaptive difficulty
  settings.js           -> family alert (web-push) registration + settings
  db.js                 -> all Supabase reads/writes + date/timezone helpers
  push.js               -> web-push subscription helper
  sw.js                 -> PWA offline shell + push/notification handling
  styles.css            -> senior-friendly design system
  config.js             -> Supabase URL + publishable key + VAPID public key
  manifest.webmanifest, icons/

supabase/
  migrations/           -> SQL for the schema, dose functions, push config + cron
  functions/missed-dose-check/index.ts  -> the cron Edge Function (web push)
```

The UI is built as small React function components written with `htm` tagged
templates (no JSX, no bundler). `react.js` binds htm to a thin `createElement`
wrapper so templates can use plain `class` and string `style` attributes.

### Data model (Supabase, all `myday_`-prefixed)
| table | purpose |
|---|---|
| `myday_settings` | single row: patient display name + timezone |
| `myday_medications` | the 1–3 medicines (name, dose, `times[]`, note, active) |
| `myday_doses` | one row per medicine per time per day; `status` + timestamps |
| `myday_appointments` | date, time, doctor, location, reason |
| `myday_game_results` | game type, score, difficulty, played_at, details |
| `myday_family_devices` | family web-push subscriptions |
| `myday_push_config` | **server-only** VAPID keypair (locked down by RLS) |

Every table carries a `patient_id` (defaulted to a single constant today) so a real
`patients` table can be introduced later without reshaping the schema.

### How dose times stay correct across timezones
Medicine times are stored as local wall-clock `HH:MM`. The shared SQL function
`myday_refresh_doses(timezone)` converts them into absolute `due_at` instants using
the patient's timezone, so the every-5-minute cron and the browser agree on exactly
when a dose was due. The browser reports its own timezone into `myday_settings` on
load.

---

## Security model (please read)

This app deliberately has **no login**. The target user has mild dementia, and a
sign-in screen would be a real barrier to daily use. Access is therefore via
Supabase's public **publishable key**, and Row Level Security policies on the
`myday_` tables allow the `anon` role full access. In practice this means *anyone
who has the site URL and key could read/write this single patient's data*. For this
personal, single-patient app that is an accepted trade-off (and it matches how the
other small apps in this Supabase project are set up).

What is **not** public:
- The **VAPID private key** lives in `myday_push_config`, which has RLS enabled and
  **no policy**, so the browser can never read it. Only the Edge Function (service
  role) can. It is never committed to this repo.

To harden later (recommended if this ever serves more than one trusted household):
1. Turn on Supabase Auth (e.g. a single shared account, or a magic-link the family
   manages) and replace the `using (true)` policies with `patient_id`-scoped checks.
2. Set the Edge Function's `verify_jwt` back to `true`.

---

## Running locally

It's a static site; serve the `public/` folder over http (a service worker needs
http/https, not `file://`):

```bash
cd public
python3 -m http.server 8080
# open http://localhost:8080
```

`public/config.js` already points at the live Supabase project, so it works
immediately. Web-push registration needs **https** (or `localhost`, which browsers
treat as secure).

---

## Deploying to Cloudflare Pages

1. Connect this repo in the Cloudflare Pages dashboard (or `wrangler pages deploy`).
2. Settings:
   - **Build command:** *(none — static site)*
   - **Build output directory:** `public`
3. Deploy. The PWA, manifest, and service worker are served from the site root.
   `public/_redirects` provides an SPA fallback and `public/_headers` keeps the
   service worker fresh.

---

## Supabase setup (already applied to project `hcvjiveloioftozvnbhe`)

The SQL in `supabase/migrations/` reflects what is deployed:
- `0001_schema.sql` — tables, RLS policies, triggers, seed settings row.
- `0002_functions.sql` — `myday_ensure_doses_for_date`, `myday_refresh_doses`.
- `0003_push_and_cron.sql` — `myday_push_config`, `pg_net`/`pg_cron`, the 5-minute
  schedule.

The Edge Function is in `supabase/functions/missed-dose-check/`. It uses the
auto-provided `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars and reads VAPID
keys from `myday_push_config`. Web push (RFC 8291 / aes128gcm) is implemented with
the Web Crypto API — no external push library.

### Web-push keys
A VAPID keypair was generated for this deployment. The **public** key is in
`public/config.js`; the **private** key is stored only in `myday_push_config`. To
rotate: generate a new pair (`npx web-push generate-vapid-keys`), update
`config.js` and the `myday_push_config` row, and re-subscribe family devices.

---

## A note on iPhones
On iOS, web push only works when the app is **added to the Home Screen** and opened
from that icon. Open MyDay in Safari, Share → *Add to Home Screen*, then open it
from the Home Screen and turn on alerts under **Family & Settings**.
