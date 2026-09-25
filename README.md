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
- **Bottom navigation** — Home, Updates, Medicine, Visits, Games, Profile.
- **Forgot password** — a plain-language email recovery flow (`/forgot` →
  `/reset-password`), linked from the sign-in screen.
- **Home** — a warm dashboard: greeting, today's medication status with a progress
  bar, a prominent "due now" reminder with one big Done button, and quick links.
- **Medication** — three views via a segmented control:
  - **Today** — each dose with a big "Done - I took it" tap (pending / taken / missed).
  - **Calendar** — a MediSafe-style month calendar with per-day adherence dots; tap a
    day to see that day's doses.
  - **Medicines** — add / edit / remove any number of medicines & vitamins (name,
    dose, multiple daily times, color, note).
- **Appointments** — date, time, doctor, location, reason; soonest first.
- **Updates (health diary)** — a timeline of symptoms, health events, and notes.
- **Profile** — "about me" intake (name, birthday, age, *what I'm on*, *what I'm
  working toward*), typed **contacts** (pharmacy, provider, clinic, insurance,
  merchant, other), **light/dark theme**, missed-dose alerts, and sign out.
- **Brain Games** — its own bottom-nav tab, with six games: Match the Pairs, Word
  Puzzle, Number Patterns, Quick Math, Odd One Out, and Today (orientation).
  **10 difficulty levels** with a level picker plus adaptive difficulty. Scores
  are saved with a progress view, and a result that fails to upload is kept on
  the device and replayed on reconnect rather than lost.
- **Add button (FAB)** — a floating + opens a quick menu to add a medication,
  appointment, health note, or contact from anywhere.
- **Light & dark themes** — toggle in the top bar or in Profile; remembered per user.
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
  glass.css                                 -> Apple-style glass layer (loaded last): palette, frosted surfaces, motion, alerts
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

## Supabase (already configured on project `zciulgqkqusjxomyapcz`)

- Schema, RLS, dose functions and the 5-minute cron are applied (see
  `supabase/migrations/`).
- Edge Functions deployed: `signup` (instant pre-confirmed accounts) and
  `missed-dose-check` (cron + multi-user web push). Both are implemented with Web
  Crypto — no external push library.
- A pre-existing, broken `handle_new_user` trigger on `auth.users` (from another app
  in the same project) was blocking all sign-ups; it was fixed and made
  exception-safe so a profile insert can never block account creation.
- Web-push VAPID keys are stored in `myday_push_config` (private key server-side
  only); the public key is in `src/lib/supabase.js`.

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
