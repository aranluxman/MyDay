// The notification rules live in supabase/functions/_shared/ so that the
// browser, the service worker and the Edge Function that sends web push all
// run the SAME code. A second copy would drift, and the drift would show up as
// a missed-dose alert the settings screen promised and the sender suppressed
// (or, worse, the other way round).
//
// This file is the client's import surface; the rules themselves, and the
// tests that cover them, live in notificationRules.js.
export * from '../../supabase/functions/_shared/notificationRules.js';
