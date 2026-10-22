# MyDay

A calm, modern, **multi-user** health companion for older adults: medications,
appointments, a health diary, contacts, a profile, and brain games — with sign-in
so each person has their own private space.

Built with **React + Vite (JSX)**, **Supabase** (Auth + Postgres + Edge Functions
+ cron), and shipped as an installable **PWA**. Deploys to **Cloudflare Pages**.

---

## Features

- **Accounts** — email + password sign up / sign in / sign out. Each person's data
  is private (per-user Row Level Security). Sign-up is instant (no email-confirmation
  step), which is friendlier for older users.
- **Bottom navigation** — on phones: Home, Medicine, Updates, Games and More (Visits, Profile); the desktop side rail shows all six. Alerts & reminders are a section of Profile (`/profile/notifications` opens it there).
- **Liquid Glass controls** — the tab bar / side rail, segmented controls and switches use a Liquid Glass lens (`src/liquid.css`, `src/hooks/useLiquidDrag.js`, physics in `src/lib/liquid.js`): press and slide a finger along the bar and the glass follows it, magnifying the tab under it, then springs to the nearest tab on release (Apple's momentum projection + critically damped springs). Switches turn to glass while held and can be slid. Real refraction in Chromium; frosted elsewhere; solid with Reduce Transparency / High contrast; no springs with Reduce Motion or Calm screen.
- **Forgot password** — a plain-language email recovery flow (`/forgot` →
  `/reset-password`), linked from the sign-in screen.
- **Home** — a warm dashboard: greeting over a calm landscape with a *Today*
  calendar button, then widgets the person arranges with **Edit Home** (show/hide +
  reorder, saved on the device). By default: **Quick calls** (Call Family, Call
  Doctor, Pharmacy from saved contacts — or add one — and 911, which always asks
  first), *How are you feeling today?* (one tap saves a mood note to Updates, with
  Undo), **Today's Medicines** (progress, missed-dose alert, the dose that matters
  now with its Take button), and the **Next appointment** and **Health diary** tiles.
  Today at a glance, This week, Visit history and the brain-game nudge can be
  switched on.
- **Medicine** — *Today* with this week's day strip, a "1 of 3 doses taken" ring, and
  one row per dose with a **Take** button (tap the medicine for "I took it earlier",
  "Not today" and instructions). From there: **History** (list or a month calendar
  with per-day adherence; the calendar button, the ring or any day in the strip),
  **Manage medicines** (add / edit / copy / refill / remove), and a **Reminders**
  switch for dose reminders. "+ Add" sits in the top bar.
- **Appointments** — date, time, doctor, location, reason; soonest first.
- **Updates (health diary)** — *How are you feeling now?* tiles that start a note,
  a general **Chat with MyDay**, and a day-by-day timeline of notes (Edit / Delete
  behind "…").
- **Profile** — "about me" intake (name, birthday, age, *what I'm on*, *what I'm
  working toward*), typed **contacts** (pharmacy, provider, clinic, insurance,
  merchant, other), **Alerts & reminders** (delivery check, missed doses, quiet
  hours, sound, devices), **light/dark theme**, and sign out.
- **Brain Games** — its own bottom-nav tab, with six games: Match the Pairs, Word
  Puzzle, Number Patterns, Quick Math, Odd One Out, and Today (orientation).
  **10 difficulty levels** with a level picker plus adaptive difficulty. Scores
  are saved with a progress view, and a result that fails to upload is kept on
  the device and replayed on reconnect rather than lost.
- **AI helpers** (OpenAI, via the `ai-assist` Edge Function — the key never reaches the browser):
  - **Add from a photo** — take up to 3 photos of a pill bottle or box (front, back,
    pharmacy label); the AI reads them together for the name, dose, times and directions and opens the Add Medicine wizard on its review step so the
    person checks it before saving. Warnings (anything it couldn't read) are shown.
  - **How your medicines work together** — on the Medicines tab: what each medicine is
    for, its benefits, how they group around shared goals, and calm "worth asking your
    pharmacist" notes. Cached on the device until the medicine list changes.
  - **Ask about your medicines** (`/medication/ask`) — "Have a question?" under that
    explanation opens a follow-up Q&A page (ai-assist `medicine_chat` mode). General
    information only, with a not-medical-advice banner and a note under every answer;
    dosing questions ("how much", "can I stop", missed doses) get a fixed pharmacist
    redirect, and replies that call a combination safe are replaced (checked on the
    server and again in the browser).
  - **Chat with MyDay** — on any health-diary note (Updates), and offered right after
    saving one: an upbeat, encouraging chat that celebrates good days and, for symptoms,
    asks one gentle question at a time (sleep? water? a missed pill?). Never diagnoses;
    red-flag symptoms get a "Call 911" button. Nothing is stored unless they tap
    "Save this to my note".
- **Add a medicine** (Home or the + menu) first asks "Take photos of the box" or
  "Type it in myself".
- **Add button (FAB)** — a floating + drops out a menu to add a medication,
  appointment, health note, or contact from anywhere.
- **How to use MyDay** — a step-by-step guide for first-time users, as the last section of Settings (Profile). The old `/help` link opens Settings.
- **Languages** — Profile → Language shows the whole app in French, Chinese, Tamil,
  Punjabi, Hindi, Urdu, Spanish, Portuguese, Italian and more (Google page translation,
  `src/lib/translate.js`).
- **Guardian nudge** — Home asks people with no connected guardian to set one up.
- **Appearance** — System (follows the device, live), Light or Dark from the top-bar button or Profile → Appearance, plus eight colour themes; remembered per user.
- **Missed-dose push alerts** — a cron Edge Function flips overdue doses to missed
  and web-pushes the user's family devices, e.g. *"Mary has not taken their 9:00 AM
  medication."*
- **Guardians via a 6-digit code** — the patient taps *Invite a guardian* and reads
  out a code; the guardian types it into MyDay on their own device and starts
  receiving the alerts. No account, no link to send. A shareable link
  (`/guardian?invite=<token>`) remains as a fallback.

---

## Tech & architecture

```
index.html, vite.config.js, package.json   -> Vite app (build -> dist/)
public/                                     -> static assets copied as-is
  manifest.webmanifest, sw.js, icons/, _redirects, _headers
src/
  main.jsx, App.jsx                         -> entry + routes (auth gate)
  index.css                                 -> design system + light/dark themes
  glass.css                                 -> Apple-style glass layer: palette, frosted surfaces, motion, alerts
  liquid.css                                -> Liquid Glass for the controls layer: nav lens, segmented, switches
  screens.css                               -> Home, Medicine and Updates layouts (loaded last)
  context/AppContext.jsx                    -> session, profile, theme
  context/UIContext.jsx                     -> toasts + confirm dialogs
  components/                               -> Icon, ui primitives, AppShell, BottomNav, MedCalendar
  hooks/useAsync.js
  lib/supabase.js, db.js, format.js, push.js, games.js
  screens/                                  -> Landing, Onboarding, SignIn, ForgotPassword, ResetPassword,
                                               Home, Medication, Appointments, Updates, Profile, Games,
                                               GuardianJoin
supabase/
  migrations/                               -> schema, RLS, dose functions, cron, guardian codes
  functions/missed-dose-check/              -> multi-user cron + web push
  functions/guardian-join/                  -> public code/link pairing for guardians
  functions/signup/                         -> instant (pre-confirmed) sign-up
```

Routing uses `react-router-dom`; `public/_redirects` provides the SPA fallback.

### Data model (Supabase, `myday_`-prefixed, per-user)
`myday_profiles`, `myday_medications`, `myday_doses`, `myday_appointments`,
`myday_game_results`, `myday_family_devices`, `myday_contacts`, `myday_diary`,
`myday_guardians` + `myday_guardian_devices`, and the server-only
`myday_push_config` and `myday_join_attempts`. Every user-owned row carries
`user_id` (defaulting to `auth.uid()`), and RLS restricts every table to its owner.

---

## Security

- **Login required.** RLS allows only `authenticated` users, scoped to
  `user_id = auth.uid()` — a user can only ever see their own data.
- The **VAPID private key** lives in `myday_push_config`, which has RLS enabled with
  **no policy**, so the browser can never read it; only the Edge Function (service
  role) can. It is never committed to the repo.
- **Guardian codes are short, so they are throttled.** A 6-digit code has only
  900k values, so the public `guardian-join` function rate-limits code lookups
  twice over: 8 wrong codes per caller per 15 minutes, plus a global circuit
  breaker at 120 per 15 minutes, because a per-IP limit alone is bypassable by
  rotating addresses. A correct code clears the caller's counter and only
  decrements the global one. Codes expire after 14 days and the patient can mint
  a fresh one at any time. Invite *links* carry a 128-bit token and are not
  throttled, so they still work if the breaker ever trips.

### Notifications and why installing matters
The operating system attributes a web notification to whatever app owns the page.
In a browser tab that is Chrome or Safari, and no code in the page can change it;
installed to the home screen, the same notification is attributed to **MyDay**
with the MyDay icon. iPadOS goes further and will not deliver web push at all
until the app is on the home screen. Both places that turn alerts on (Profile and
the guardian join screen) therefore ask you to install first, with
platform-specific steps, and only offer a browser-only fallback as a last resort.

---

## Tests

```bash
npm test            # unit tests (node:test)
npm run test:sql    # applies every migration to a throwaway local Postgres 16 and runs test/sql/
npm run test:e2e    # Playwright phone/a11y tests against the built app and a mocked backend
```

The browser tests never contact Supabase: `test/e2e/mock.js` answers every request with
synthetic data. See `docs/audit/REPORT.md` for the phone/accessibility audit fixes, results,
screenshots and migration notes (apply migration 0017 before deploying the updated
`dose-action` and `ai-assist` functions).

## Guardian alert timing and day refresh

The guardian can choose 15, 30, 45 or 60 minutes after each scheduled dose, or
a fixed clock time in the medication owner's timezone. Taken and skipped doses
never qualify. A fixed-time check includes earlier untaken doses; doses due after
that time are checked the next day. The five-minute cron runs without the app open.

Before publishing this update, apply
`supabase/migrations/20261008163927_guardian_alert_timing.sql`, then deploy
`guardian-data`, `guardian-join`, `missed-dose-check` and `send-reminders` with their
existing JWT verification settings. Deploy the rebuilt `dist/` to Cloudflare Pages
after the backend update. Existing code/token checks and row access policies remain
in place. Re-enable alerts on any connection whose subscription was cleared by
the older subscription behavior.

Home and Medication refresh on reopening and every minute while visible.
Dose generation preserves completed mornings and generates an evening dose only
when that time is part of the medicine's schedule. History has a date dropdown
on both the patient and guardian screens; Profile is under More on phones.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

`src/lib/supabase.js` already points at the live Supabase project, so it works
immediately.

## Deploy to Cloudflare Pages

Connect the repo and set:

| Setting | Value |
|---|---|
| Framework preset | **None** (or Vite) |
| Build command | **`npm run build`** |
| Build output directory | **`dist`** |

No environment variables are required (the publishable key is public and lives in
`src/lib/supabase.js`).

---

## Supabase (already configured on project `cthpunnnkdgukuogyvxm`)

- MyDay has its own project (Supabase Pro). It moved off the shared project
  `zciulgqkqusjxomyapcz` in October 2026 with its accounts (same passwords),
  data and photos.
- Schema, RLS, dose functions and the crons are applied (see
  `supabase/migrations/`).
- Edge Functions: `ai-assist` (OpenAI, see below — needs the `OPENAI_API_KEY` secret), `signup` (instant pre-confirmed accounts),
  `missed-dose-check` (cron + multi-user web push), `send-reminders` (cron),
  `daily-summary` (hourly cron, 8pm recap), `dose-action`, `guardian-join` and
  `guardian-data`. Push is implemented with Web Crypto — no external push library.
- Web-push VAPID keys are stored in `myday_push_config` (private key server-side
  only); the public key is in `src/lib/supabase.js`.

### Sign in with Google

The "Continue with Google" button appears on Sign in and Create account by itself once Google is
switched on in Supabase (it checks the project's public auth settings, so it is hidden until then).

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: app name `MyDay`, your email, publish.
2. **Credentials** → Create credentials → **OAuth client ID** → Web application.
   - Authorized JavaScript origins: `https://myday-1rn.pages.dev`
   - Authorized redirect URIs: `https://cthpunnnkdgukuogyvxm.supabase.co/auth/v1/callback`
3. Supabase (project `cthpunnnkdgukuogyvxm`) → Authentication → **Sign In / Providers** → **Google** →
   enable, paste the Client ID and Client Secret → Save.
4. Supabase → Authentication → **URL Configuration**: Site URL `https://myday-1rn.pages.dev`, and add it to
   Redirect URLs.

### Branded password-reset email

Supabase sends the "forgot password" email. By default it is titled for Supabase, which confuses people.
To make it say MyDay (about 2 minutes):

1. Supabase Dashboard → **Authentication** → **Emails** (Email Templates) → **Reset password**.
2. **Subject:** `Reset your MyDay password`
3. **Body:** paste the contents of `supabase/email-templates/reset-password.html`.
4. **Save.** Send yourself a test with "I forgot my password".

The sender name ("Supabase Auth") only changes with custom SMTP (Authentication → Emails → SMTP
Settings, e.g. Brevo or Resend) — set the sender name to `MyDay` there when you're ready.

### AI helpers setup (OpenAI)
The OpenAI key is a Supabase **function secret** — never put it in the frontend.

```bash
supabase secrets set OPENAI_API_KEY=sk-...          # required
supabase secrets set OPENAI_MODEL=gpt-4o-mini       # optional; must support images + JSON schema
supabase functions deploy ai-assist
```

Only signed-in users can call it (it checks the session token). Set a monthly
spending limit in the OpenAI dashboard, since every scan/explain/helper turn is a
paid call. Photos and medicine names are sent to OpenAI, and a diary note is sent only when
the person opens "Chat with MyDay" on it; the person's name is never sent.

### iPhone / iPad note
On iOS and iPadOS, web push only works when the app is **added to the Home Screen**
and opened from that icon (Share → Add to Home Screen).

### Password reset setup
Two settings under **Authentication → URL Configuration** in the Supabase
dashboard, and it is worth being clear about which one actually matters.

**Site URL — required.** When Supabase does not recognise a `redirectTo`, it
falls back to the Site URL, so this is where every recovery email ends up if
anything else is misconfigured. Left at the default `http://localhost:3000`, the
link in the email is dead for everyone. Set it to the deployed origin.

**Redirect URLs — recommended, not required.** `/forgot` calls
`supabase.auth.resetPasswordForEmail` with a `redirectTo` of
`<origin>/reset-password`; listing that URL (for the production domain and for
`http://localhost:5173`) is what makes the link land on the reset screen's own
route. Without it the link still works: `CAME_FROM_RECOVERY_LINK` in
`src/lib/supabase.js` reads the recovery token out of the URL fragment before the
client consumes it, and `App.jsx` renders the reset screen whenever that flag is
set — on any path, not just `/reset-password`. Verified by loading the built app
at `/`, `/signin` and `/reset-password` with a recovery fragment; all three show
"Choose a new password".

The Supabase default SMTP sender is rate-limited to a couple of messages an hour;
configure a custom SMTP provider before real users rely on it.
