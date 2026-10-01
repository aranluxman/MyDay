import { useEffect, useState } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase.js';

// "Continue with Google". It only appears once Google sign-in is switched on
// in Supabase (Authentication -> Sign In / Providers -> Google). Until then
// the project's public settings say google:false and the button stays hidden,
// so nobody is ever shown a button that leads to an error page.
let googleEnabled = null; // cached for the session: one settings call, not one per screen

async function isGoogleEnabled() {
  if (googleEnabled !== null) return googleEnabled;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    const s = await res.json();
    googleEnabled = !!s?.external?.google;
  } catch { googleEnabled = false; }
  return googleEnabled;
}

export function GoogleButton({ label = 'Continue with Google', onError }) {
  const [show, setShow] = useState(googleEnabled === true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { let alive = true; isGoogleEnabled().then((v) => alive && setShow(v)); return () => { alive = false; }; }, []);
  if (!show) return null;

  async function go() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Back to the app's front door; the session in the URL signs them in and
      // a first-time Google user gets their profile made automatically.
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
    if (error) { setBusy(false); onError?.('Could not open Google sign-in. Please try again.'); }
  }

  return (
    <>
      <div className="ob-or"><span>or</span></div>
      <button type="button" className="google-btn" onClick={go} disabled={busy}>
        <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        <span>{busy ? 'Opening Google…' : label}</span>
      </button>
    </>
  );
}
