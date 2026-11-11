# Medication safety: what is connected, and what a real integration needs

**Status (November 2026): no clinical data source is connected.** The Medication
safety page shows "Not checked · Service not connected" for the interaction
checker, side-effect information and nutrient information. It never shows an
all-clear.

## Why nothing is faked

An interaction "result" that did not come from a maintained clinical database
is worse than no result: a reassuring empty list reads as "safe". So the rule
in `src/lib/medSafety.js` (covered by `test/medSafety.test.js`) is that with no
source connected every check answers `not_connected`.

The AI helper ("How your medicines work together", "Ask about your medicines")
is general information only and is labelled as such on the page. It is not a
source for any of these checks and must not be wired into them.

## What a real integration needs

1. **A licensed, maintained clinical source** covering Canadian products
   (DIN / Health Canada Drug Product Database names), with a published update
   cadence. Free US label data does not cover interactions and misses Canadian
   brand names.
2. **A Supabase Edge Function** (for example `med-safety`) that holds the API
   key as a secret, takes the signed-in user's own active medicines, calls the
   service and returns findings. The key must never reach the browser.
3. **Mapping** from the free-text medicine names in `myday_medications` to the
   source's identifiers, with an explicit "could not match" result per
   medicine. An unmatched medicine must be reported as not checked.
4. **Wiring** in `src/lib/medSafety.js`: set `SAFETY_SOURCES.<check>` to
   `{ name, updated, run }`, where `run(meds)` resolves to an array of
   `{ text, medicines: string[], severity?: string, url?: string }`.
   `name` and `updated` (the date the source's data was last updated) are
   shown with every result.
5. **Wording review**: an empty result is shown as "{source} lists nothing for
   these medicines. This is not a guarantee", always with the pharmacist
   prompt. Findings are information, never an instruction, and the app never
   changes a schedule, dose or spacing because of one.

Until all five are in place, leave `SAFETY_SOURCES` as it is.
