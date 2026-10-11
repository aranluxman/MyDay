# MyDay engineering validation

Prepared October 11, 2026 from repository commit `d720e4428e6bf950a177101fdf86c75e44540f6f`, on local branch `fix/engineering-behavior`.

Before publication, the branch was merged with updated `main` at `7214c5d` to include the latest dashboard changes. Validation was repeated against the combined code.

## Implemented

- Chat uses “Chat is unavailable right now. You can still use your health diary.” Raw configuration/provider errors are hidden, including errors from an older backend. Return to health diary is always available on failure. Retry is offered for temporary network/service/rate-limit failures, and withheld for configuration, credential, quota, validation and refusal errors.
- Chat's system prompt prohibits diagnosis, prescriptions, dose changes, inferred symptom causes and treatment recommendations. Clinical requests use a deterministic boundary response; representative unsafe generated replies and suggestions are blocked on the server and again in the browser. Existing emergency escalation takes precedence over a clinical refusal. Saved generated replies are labeled as not clinical advice. The provider request has a 25-second timeout.
- Sending and saving use synchronous request guards to prevent duplicate actions. Conversation context retains both sides of twelve exchanges. Incoming replies preserve the reading position when the user scrolls up; requests finishing after the dialog closes do not update its state.
- The guest, account and legacy invite guardian flows share one labeled, full-width numeric input. It supports full-code paste (including separators), native cursor/backspace editing, one-time-code autofill and Enter submission. It keeps rejected codes available to edit, links expired-code feedback to the field, and dismisses the keyboard on submission. Name and six-digit prerequisites disable Connect where a name is required. The single input needs no movement between separate digit boxes.
- Disabled buttons have a distinct background and dashed border while keeping opaque, readable text.
- Notification permission, settings, device registration and a push service accepting a send remain separate states. The UI does not claim receipt from the server's historical `delivered` count. A registered device whose subscription was disabled can be reconnected. “This device” is determined by the current push endpoint; relative nicknames such as “This phone” use a platform name and other rows are marked “Saved device”.
- Landing-page copy follows each guardian's saved delay or fixed time, rather than promising one hour. Settings explain the profile's current missed-dose window, medicine overrides, independent guardian timing and the five-minute checks. Notification timing and dose-state algorithms are unchanged.
- Add medicines, photo entry and the six-step wizard replace one another. Intentional nested time pickers/confirmation dialogs retain the existing focus trap. The wizard has a stable title, accessible step progress and pinned Back/Continue actions. Generic dialog bodies scroll separately from their titles/footers. Diary cards wrap at 200% scaling.
- Default/whitespace-only medicine forms are not persisted. Meaningful names, dose/schedule changes, notes and photos remain recoverable, including staged batch reviews. Old empty batch drafts are ignored. Closing the complete medicine flow returns focus to its original opener.

## Automated evidence

Run from the repository root:

```sh
npm ci
npx playwright install chromium
npm test
npm run build
npm run test:e2e
```

The browser tests use synthetic patient data and intercept backend requests; no patient records, live OpenAI calls or push subscriptions are used. Tests load the production build. The Deno AI handler is also executed with synthetic authentication and an OpenAI transport stub.

Results: 214 unit tests passed; the production build passed; all 114 browser tests passed, including the existing axe checks. The final safety-check adjustment was also verified against the rebuilt app with the focused unsafe-output browser test. `git diff --check` passed.

Coverage includes 360×800, 390×844 and 430×932 at normal and 200% CSS zoom, 400px reduced available height, long medicine names, paste/backspace/Enter, disabled prerequisites, inline expiry, empty/meaningful drafts, dialog focus restoration, raw configuration-error suppression, selective retry, multi-turn history, duplicate send/save prevention, scroll persistence, unsafe generated replies, device identity and accepted/failed push-service sends. iPhone 13 and Pixel 7 browser profiles verify the correct installation instructions. Existing layout, dose integrity, history, notification timing and axe accessibility checks are included in the full suite.

200% checks exercise enlarged rendering and reflow in Chromium. Reduced viewport height models the space above a keyboard; it does not reproduce a native mobile keyboard.

## Physical-device validation still required

These checks cannot be completed by desktop Chromium emulation. Use dedicated test accounts on an iPhone with Safari and an Android phone with Chrome after deployment:

| Check | Expected evidence | Status |
|---|---|---|
| Native code keyboard | Numeric keyboard opens; paste/autofill, cursor selection and backspace work; submitting hides it | Pending |
| Native medicine/chat keyboard | Fields scroll into view and Back/Continue/Send stay reachable when the keyboard opens and closes | Pending |
| iOS Add to Home Screen | Safari Share → Add to Home Screen → launch from the new icon; guardian icon opens the correct route | Pending |
| Android installation | Accept and dismiss native install prompt; reopen installed app and confirm route and saved draft | Pending |
| Push receipt | Enable OS permission and registration, send a test, and visually confirm the notification on the intended device | Pending |
| Background/locked phone | Confirm an alert appears with the app backgrounded or the device locked, then opens the intended view | Pending |
| Blocked/offline/OS suppression | Turn off OS notifications, disconnect temporarily, and test quiet/Focus settings; UI never claims receipt merely from a send | Pending |
| Two devices | Register two devices with the same nickname; only the matching endpoint is marked “This device”; verify each receipt independently | Pending |
| Native 200% text setting | Enable large system/browser text and repeat diary, code, wizard and chat flows | Pending |

Boundary regression tests cover representative English inputs and generated outputs. The model prompt applies to all languages; the runtime pattern checks are a conservative backstop, not a comprehensive classifier. Live model behavior and additional languages have not been evaluated in this run.

## Applying the change

The original reviewable patch applies to the initial base commit above with `git apply myday-engineering.patch`. It includes source changes, unit/browser tests and this checklist. The pull request also incorporates the updated main branch. Rebuild the frontend and deploy the updated `ai-assist` Edge Function to make both client and server behavior live. No migration, secret change or notification-timing change is included. The user approved branch and pull-request publication; merging and deployment still require separate approval under the supplied AGENTS.md instructions.
