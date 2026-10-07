# MyDay — phone audit fixes: report

All work is local and on branch `claude/great-johnson-zc0l6d`. Nothing was deployed, no
production record was read or changed, and no notification was sent. Every browser test runs
the built app against an in-memory mock of the backend (`test/e2e/mock.js`) with synthetic
data; the database migration is tested against a throwaway local Postgres 16.

## Fixes by priority

### P0 — silent dose modification (fixed)
- **Root cause:** `clampAmount()` in `src/lib/doseUnits.js` snapped every amount to the nearest
  ½ and floored it at ½ (2.75→3, 0.1→½, −1→½). Separately, `dose_amount` was `numeric(10,2)`,
  which Postgres silently rounds (0.125→0.13). The photo scanner used the same clamp.
- **Fix:** amounts are exact or refused. `parseAmountInput()` accepts `2.75`, `0,1`, `.5`,
  `1/2`, `1 1/2`; refuses empty, zero, negative, non-finite, exponent, malformed, >9999, more
  than 4 decimals and fractions with no exact decimal (1/3). The wizard stores the typed text,
  the review shows it, the payload re-validates it, and `saveMedication` re-reads the stored
  value and clears the structured amount (falling back to the exact text) if a database still
  on the old column rounded it. Migration 0017 widens the column to `numeric(12,4)`.
- Measured units render as decimals with a leading zero (`0.5 mL`), countable ones as
  fractions (`1/2 tablet`). `mcg` is a real unit. Teaspoons are no longer silently turned into mL.

### P1
| Finding | Fix |
|---|---|
| Missed-dose classifications disagree | `MedCalendar` counted raw server status. All views now use `countsByDay()` → `doseState()`, which also honours a per-medicine missed window like the server. Accessible day labels are built from the same counts. Future days show a clearly labelled **Planned** schedule. |
| "Skip to the summary" bypasses validation | One whole-draft validation (`medicineProblems`) gates Continue, Skip, Save, Add to review and batch save; it takes the person to the field and focuses it. PRN stays valid with no times. Database `NOT VALID` checks enforce the same rules for new/edited rows. |
| Inverted treatment dates | Refused in UI (focus + linked message) and DB (existing check). Review shows Starts / Stops / Length. "for N days" uses local dates (it used UTC before, which could pick tomorrow in the evening). |
| Floating Add covers a phone setting | The + only appears on Home, Medicine, Visits and Updates; pages with it reserve room. |
| Bottom nav covers medication actions | Slimmer nav on short screens, `scroll-padding` so focused controls scroll clear, content padding for nav + FAB. Every action on Today is tested to scroll fully clear and receive the tap at 6 viewports × 2 text sizes. |
| Largest text breaks small phones | Phone nav is Home · Medicine · Visits · Profile · **More**; grids/rows/segmented controls/badges wrap; calendar columns can shrink; broken avatar no longer widens the page. The nav, title bar and + are capped at the largest sizes (labels ≥13px; were ~9px). |
| Dialogs fail focus containment | `useDialog`: focus entry, Tab trap in the topmost dialog, background `inert`, Escape closes only the top dialog (time picker before wizard), focus restored to the opener. Used by every sheet, the wizard, time picker, confirm alert and card viewer. Editing with unsaved changes asks before discarding. |
| Duplicate validation alerts | No `role="alert"` on field errors; one message per field, linked by `aria-describedby`, announced by moving focus to the field. Review shows one summary list. |
| Notification devices indistinguishable | Current device matched by push endpoint and marked "This device"; others named by platform, numbered when names repeat, with "added <date> · installed app/browser". Remove labels and confirmations name the device; removing the last device warns. New registrations use the real device name instead of "This phone". |

### Accessibility / UX enhancements
- 44×44 minimum targets without "Bigger buttons" (switches are 48px tall with the track inside; tabs/segments 48px; top bar 44px). Calendar day cells are the one exception (≥24px, WCAG 2.5.8).
- Secondary text ≥14–15px; body/form 16–17px.
- Contrast: measured with axe-core on 4 screens × all 8 themes. **Before:** real AA failures
  (e.g. grey text on page background 4.43:1, white on green "Done" 3.27:1 Light / 2.29:1
  Midnight, white on blue 3.31:1 Dark, blue text on tinted buttons 3.5–4.4:1) — see
  `axe-before-contrast-fix.txt`. **After:** 0 violations (`axe-after.txt`). AAA was not
  pursued across the board.
- Notification dropdowns and switches have programmatic labels/descriptions.
- Medication views are real tabs (ids, `aria-controls`, tabpanel, roving tabindex, Arrow/Home/End). Value pickers are radiogroups.
- Colour swatches are named ("Blue") with checked state; contact type is a radiogroup (no more "Type Provider Clinic…").
- Skip-to-content link, per-route titles ("Medication · MyDay"), focus moves to the page on navigation.
- Time picker: type any minute (native time field) or use ±1 hour/minute and :00/:15/:30/:45, explicit AM/PM, duplicates refused.
- `prettyClock` now writes "9:30 AM" like scheduled times (it wrote "9:30 a.m." beside "9:00 AM").

### Medication tracking and safety
- **Strength vs amount:** optional label strength (kept as written, never calculated), route and label directions, shown beside — never merged with — the amount.
- **Logging:** `myday_take_dose` is atomic (row lock) and idempotent; double taps/retries/notification+app races give one `taken`, one `taken_at`, one stock decrement. UI locks the dose while saving, and confirms "Recorded: <medicine> <dose> — <scheduled time> dose, taken at <time>" with Undo. "I took it earlier" records the actual time separately from the scheduled time. The notification "I took it" button uses the same function.
- **Skips:** a taken dose can't be overwritten by "Not today"; "I took it already" is no longer a skip reason (it is recorded as taken). Snapshots of name/dose are stored when logged.
- **PRN:** as-needed medicines appear on Today with "I took one just now / earlier"; a client-generated id makes retries safe; never counted in adherence.
- **Inventory:** optional stock, refill threshold, refill history, pharmacy/prescriber links with Call buttons. Decrements only on confirmed taken, restored on undo, never for missed/skipped; unknown stock never blocks logging; days left is labelled an estimate.
- **Adherence:** denominator documented on screen (scheduled, settled taken/missed; excludes upcoming, skipped and PRN).
- **Reminder readiness:** separate checks for preference, per-medicine reminders, permission, this-device subscription and last send — "sent" is never presented as "delivered".
- **Contacts:** emergency-contact flag, relationship, phone validation, accessible Call button; copy says MyDay never calls anyone and guardians are not an emergency service.
- **Offline:** banner when offline; failures say "NOT saved / Nothing was recorded"; drafts are kept.
- **Delete/copy:** Remove names the medicine and dose, keeps history, offers Undo, and also clears that medicine's still-pending doses (they used to linger and turn into "missed" alerts). Copy opens a review and saves nothing until confirmed. Remove is also available inside Edit.
- **AI prompts:** no compatibility/safety assertions, no catch-up or dose calculations, no invented schedule when a label has no directions, amounts copied exactly.

### Requests from the owner (Aran)
1. **Settings too crowded:** Profile and Alerts sections fold to one line with a summary
   ("Light theme", "Missed after 1 hour · 2 devices"). **Minimize all / Show all** at the top;
   sections start folded once the profile is complete; each remembers open/closed.
2. **Medicines not coming through:** dose generation ran fire-and-forget at sign-in, so Today
   often loaded before the day's doses existed. Reads now wait for a shared refresh; edits,
   copies, restores and removals re-sync today's doses; as-needed medicines now show on Today.
   **Hard to delete:** clearer Remove with name, Undo, and Remove inside Edit.
3. **"How your medicines work together":** has a Minimize button, stays minimized (remembered),
   and reopens with one tap.

## Tests
| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 188 passed |
| SQL (Postgres 16, migrations 0001–0017, down + re-up) | `npm run test:sql` | all passed |
| Browser (Chromium emulation) | `npm run test:e2e` | 86 passed |

Browser tests cover: exact decimals through review/save/reopen; invalid-amount rejection with
single linked message; summary-shortcut and inverted-date validation; status agreement across
Today/History/Calendar/Home; modal focus, Escape, inert, restore; time entry; idempotent logging,
stock, Undo, "took it earlier", offline, PRN, remove/undo, copy; layout at 320/360/390/430,
844×390, 390×400 with Normal and Largest text (overflow, nav overlap/clipping/size, FAB, action
reachability, name truncation); 44px targets; tab semantics; labels; device distinction; skip
link and titles; folding settings; insights minimize; axe-core on all themes.

**Not done and not claimed:** no physical iOS/Android device, no VoiceOver or TalkBack session,
no real push delivery, snooze/repeat/quiet-hours/DST delivery on devices, or expired
subscription handling on real devices. "200% text" was tested as the app's Largest setting
(CSS zoom 1.4) at 320px, which is the WCAG reflow width; the browser's own text-only zoom was not.

## Before / after (synthetic data, Chromium phone emulation)
`docs/audit/screenshots/`: 01 Medication 320 Largest · 02 Profile 320 Largest · 03 Alerts 320 ·
04 Medication 844×390 · 05 Review after typing 2.75 mg (before: "3 mg") · 06 History calendar ·
07 Settings folded. Regenerate with `node test/e2e/screenshots.mjs` (old build on :4174, new on :4173).

## Migration notes (0017)
- File: `supabase/migrations/0017_dose_integrity_and_safety.sql`; rollback:
  `0017_dose_integrity_and_safety.down.sql` (refuses to run if it would round a stored dose or
  orphan an `mcg` unit).
- Widening only; nothing rewritten. New checks are `NOT VALID` (new/edited rows only).
- **Order:** apply 0017 **before** deploying the updated `dose-action` and `ai-assist` functions.
  The web app works before the migration (it falls back to the older safe paths and only sends
  new columns when set), but PRN logging, refills and `mcg` need 0017, and the updated
  `dose-action` returns an error until `myday_take_dose` exists.
- Existing rows with no times or no weekdays are not rejected, but must be fixed on next edit.

## Remaining limitations
- The server sweep still leaves doses of reminder-off medicines as `pending`; every screen
  classifies them with the shared client rule, but the raw column differs.
- Offline writes are refused honestly, not queued. Safe offline logging would need a durable
  queue keyed by the same idempotent ids; not built.
- On phones the nav/title bar/+ do not grow past ~1.0–1.12× at Largest text (content does).
- Calendar day cells are ~41px wide at 320px (≥24px rule met, not 44px).
- Contrast was checked by axe on rendered states; translucent "glass" layers over animated
  backgrounds can vary and were spot-checked, not exhaustively.
