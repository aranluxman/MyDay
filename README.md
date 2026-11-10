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
- **Navigation** — a bottom bar on phones (Home, Medicines, Appointments, Diary, More) and a deep green side bar on laptops and tablets that lists every page. **More** is a page (`/more`) with Contacts, Games, Care team, Settings and How to use MyDay. URLs: `/`, `/medication`, `/appointments`, `/updates`, `/contacts`, `/games`, `/profile`, `/more`. Every page has one labelled **Settings** button at the top that opens **Quick settings** (text size, this device's phone-alert status, Edit profile, the caregiver dashboard for people who support someone, All settings); under the title a profile chip names whose information is on screen, with the page's **Add** beside it. Installing MyDay and the light/dark choice live in Settings, not in the header.
- **The November 2026 look** (`src/redesign.css`, loaded last) — white cards on a very light green page, forest green actions (`#175C43`), pale mint surfaces (`#EAF5EE`), 22px card corners, 48px touch targets, one quiet border instead of shadows. The other colour themes (Ocean, Sky, Sage, Lavender, Rose, Peach, Sand), Dark and High contrast keep working through the same tokens. The sliding "Liquid Glass" lens on the tab bar, segmented controls and switches was removed: the bar is flat and the page you are on is a pale pill with a bold label.
- **Forgot password** — a plain-language email recovery flow (`/forgot` →
  `/reset-password`), linked from the sign-in screen.
- **Home** (`/`) — a compact greeting, a one-line count ("1 of 4 doses recorded", with "1 dose not recorded" when something needs a look), then **Next medicine**: the dose that needs attention first, with its amount, scheduled time, a worded status and **Record as taken** inside the first phone screen. It is the same dose row used everywhere, so tapping the medicine opens "I took it earlier", "Not today" and the correction ("Remove this record"). A dose whose window has passed says **Dose not recorded** with **Review dose** — MyDay never tells anyone to take a late dose. **Also today** lists the rest of the day by Morning / Afternoon / Evening / When needed. Below: the mood check-in (with **Chat with MyDay**), **My calendar**, **Next appointment** and **Contacts**, arranged with **Edit Home**. The emergency call is set apart and always asks first.
- **Medicines** (`/medication`) — opens on **today's doses**. Where the page is wide enough (a laptop, an iPad on its side) the chosen day sits beside a compact month calendar; narrower screens show today with a week strip, and **Calendar** shows the month (that choice is remembered on the device). The calendar works with the keyboard: arrow keys move a day or a week, Home / End go to the week's ends, Page Up / Page Down change month, and the chosen day is announced. Every dose shows *Scheduled* and *Taken* times with an **On time** / **Late by …** tag and records with **Record as taken** (or **Review dose** once its window has passed). Another day shows in place (the plan for later days; yesterday can still be corrected with the real time; older days are read-only). Below: **Your history** (last 7 / 30 days, then a list with date range, Taken / Not recorded / Not today and medicine filters, or a month calendar), **Manage medicines** (add / add several / edit / copy / refill / remove) and a **Reminders** checklist that says separately whether MyDay reminders are on, whether this device allows alerts, and whether a test alert has been seen. "+ Add" sits in the top bar.
- **Appointments** — **Upcoming** / **Past** tabs with booked appointments first, one **Add appointment** button, then **Quick add** tiles (Doctor visit,
  Lab test, Pharmacy pickup, Dentist, Eye exam, Other) that open the form with the
  reason filled in, and compact rows with the date, a picture of the kind of visit,
  who, where and when. Tapping a row opens Call, Directions, Add to calendar, Edit
  and Remove. "+ Add" sits in the top bar.
- **Tab colours** — Medicine and Games are toasted orange, Appointments purple
  (light and dark); other screens keep the colour theme the person picked, and the
  High contrast theme is never recoloured.
- **Health tracker** (`/health`, also the second half of the Diary tab) — water, sleep, weight, blood pressure and heart rate, plus mood and symptoms (which stay in the diary, where they always were). Each card shows the newest value with its unit and when it was logged, or "Not logged"; **Log** opens a form with the right fields (systolic and diastolic for blood pressure, hours and minutes for sleep, kg or lb for weight). **Trends & history** shows one bar per day and the full list, where an entry can be edited or deleted. A day with no entry is an empty dashed slot, never a zero. MyDay sets no targets and never judges a reading (`src/lib/healthLogs.js`, table `myday_health_logs`, private to its owner).
- **Health profile** (Settings → Health profile) — name, birth date (age is worked out from it), gender, height, weight, conditions, allergies and goals. Every field is optional; a blank reads "Not entered", and "No known allergies" is its own answer. It shows "4 of 7 details entered", not a percentage.
- **Reports** (`/reports`) — the signed-in person's own records for the last 7, 30 or 90 days: medication totals (with the denominator spelled out: scheduled doses whose time has passed; "not recorded" is not "not taken"), health logs and, only if ticked, diary notes. The page is the preview; **Save as PDF or print** opens the device's print dialog. Nothing is sent anywhere (`src/lib/report.js`).
- **Health diary** (`/updates`) — *How are you feeling now?* tiles that start a note,
  a general **Chat with MyDay**, and a day-by-day timeline of notes (Edit / Delete
  behind "…").
- **Profile** — "about me" intake (name, birthday, age, *what I'm on*, *what I'm
  working toward*), typed **contacts** (pharmacy, provider, clinic, insurance,
  merchant, other), **Alerts & reminders** (delivery check, missed doses, quiet
  hours, sound, devices), **light/dark theme**, and sign out.
- **Brain Games** — its own bottom-nav tab: a streak card with this week's days,
  *Today's Game for You*, a two-column list of all eleven games and Your Progress;
  **All Categories** groups them into Word Games, Memory & Focus and Math & Logic.
  **10 difficulty levels** with a level picker plus adaptive difficulty. Scores
  are saved with a progress view, and a result that fails to upload is kept on
  the device and replayed on reconnect rather than lost.
- **AI helpers** (OpenAI, via the `ai-assist` Edge Function — the key never reaches the browser):
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
- **Add a medicine** — "Add" on Medicines (or Today's Add menu) opens the step-by-step form straight away; the last step has **Save medicine** and **Save and add another**. **Add several at once** (in Manage medicines) keeps the review-before-saving list for entering many together. Reading medicines from photos was switched off on Oct 12 (the component is still in `src/components/MedicinePhotoScan.jsx`).
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
paid call. Medicine names are sent to OpenAI (photo reading is switched off in the app), and a diary note is sent only when
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
