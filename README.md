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
- **Bottom navigation** — Home, Updates, Medication, Appointments, Profile.
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
- **Brain Games** — Match the Pairs, Word Puzzle, Number Patterns, and Today
  (orientation). **7 difficulty levels** with a level picker plus adaptive
  difficulty; scores saved and a progress view.
- **Add button (FAB)** — a floating + opens a quick menu to add a medication,
  appointment, health note, or contact from anywhere.
- **Light & dark themes** — toggle in the top bar or in Profile; remembered per user.
- **Missed-dose push alerts** — a cron Edge Function flips overdue doses to missed
  and web-pushes the user's family devices, e.g. *"Mary has not taken their 9:00 AM
  medication."*

---

## Tech & architecture

```
index.html, vite.config.js, package.json   -> Vite app (build -> dist/)
public/                                     -> static assets copied as-is
  manifest.webmanifest, sw.js, icons/, _redirects, _headers
src/
  main.jsx, App.jsx                         -> entry + routes (auth gate)
  index.css                                 -> design system + light/dark themes
  context/AppContext.jsx                    -> session, profile, theme
  context/UIContext.jsx                     -> toasts + confirm dialogs
  components/                               -> Icon, ui primitives, AppShell, BottomNav, MedCalendar
  hooks/useAsync.js
  lib/supabase.js, db.js, format.js, push.js, games.js
  screens/                                  -> Auth, Home, Medication, Appointments, Updates, Profile, Games
supabase/
  migrations/                               -> schema, RLS, dose functions, cron
  functions/missed-dose-check/              -> multi-user cron + web push
  functions/signup/                         -> instant (pre-confirmed) sign-up
```

Routing uses `react-router-dom`; `public/_redirects` provides the SPA fallback.

### Data model (Supabase, `myday_`-prefixed, per-user)
`myday_profiles`, `myday_medications`, `myday_doses`, `myday_appointments`,
`myday_game_results`, `myday_family_devices`, `myday_contacts`, `myday_diary`, and a
server-only `myday_push_config`. Every row carries `user_id` (defaulting to
`auth.uid()`), and RLS restricts every table to its owner.

---

## Security

- **Login required.** RLS allows only `authenticated` users, scoped to
  `user_id = auth.uid()` — a user can only ever see their own data.
- The **VAPID private key** lives in `myday_push_config`, which has RLS enabled with
  **no policy**, so the browser can never read it; only the Edge Function (service
  role) can. It is never committed to the repo.

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

### iPhone note
On iOS, web push only works when the app is **added to the Home Screen** and opened
from that icon (Share → Add to Home Screen).
