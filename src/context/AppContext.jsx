import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, CAME_FROM_RECOVERY_LINK } from '../lib/supabase.js';
import { ensureProfile, getProfile, saveProfile, refreshDoses, flushPendingGameResults } from '../lib/db.js';
import { deviceTimezone } from '../lib/format.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // True between opening a password-recovery link and choosing a new password.
  // That link creates a real session, so without this flag the app would drop
  // the person straight into Home and they'd never reset anything.
  const [recovery, setRecovery] = useState(CAME_FROM_RECOVERY_LINK);
  const [theme, setThemeState] = useState(() => localStorage.getItem('myday_theme') || 'light');
  const [textSize, setTextSizeState] = useState(() => localStorage.getItem('myday_text') || 'normal');

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute('data-text', textSize); }, [textSize]);

  const applyProfile = useCallback((p) => {
    setProfile(p);
    if (p?.theme) { setThemeState(p.theme); localStorage.setItem('myday_theme', p.theme); }
    if (p?.text_size) { setTextSizeState(p.text_size); localStorage.setItem('myday_text', p.text_size); }
  }, []);

  // initial session + auth subscription
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // when a user is present, ensure their profile exists + refresh today's doses
  useEffect(() => {
    let active = true;
    if (!session?.user) { setProfile(null); return; }
    (async () => {
      setLoading(true);
      try {
        const p = await ensureProfile(session.user);
        if (active) applyProfile(p);
        refreshDoses(deviceTimezone()).catch(() => {});
        flushPendingGameResults().catch(() => {});
      } catch (e) { console.error(e); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [session?.user?.id, applyProfile]);

  // Game results played offline are replayed as soon as the device is back.
  useEffect(() => {
    const onOnline = () => { flushPendingGameResults().catch(() => {}); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
  }
  async function signUp(email, password, full_name, onboarding = {}) {
    const { data, error } = await supabase.functions.invoke('signup', { body: { email, password, full_name } });
    if (error) {
      let msg = 'Could not create the account.';
      try { const body = await error.context.json(); if (body?.error) msg = body.error; } catch {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    const { data: si, error: e2 } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (e2) throw new Error(e2.message);
    // Persist the onboarding answers on the profile (upsert ensures the row exists).
    if (si?.user) {
      try {
        await supabase.from('myday_profiles').upsert({
          user_id: si.user.id,
          full_name: (full_name || '').trim() || null,
          for_whom: onboarding.for_whom || null,
          age: onboarding.age ?? null,
          timezone: deviceTimezone(),
        }, { onConflict: 'user_id' });
      } catch (e) { console.warn('onboarding upsert failed', e); }
    }
  }
  async function signOut() { await supabase.auth.signOut(); setProfile(null); }

  function setTheme(t) { setThemeState(t); localStorage.setItem('myday_theme', t); saveProfile({ theme: t }).catch(() => {}); }
  function setTextSize(s) { setTextSizeState(s); localStorage.setItem('myday_text', s); saveProfile({ text_size: s }).catch(() => {}); }

  async function updateProfile(patch) {
    await saveProfile(patch);
    setProfile((p) => ({ ...p, ...patch }));
    if (patch.theme) setTheme(patch.theme);
  }
  async function reloadProfile() { const p = await getProfile(); applyProfile(p); return p; }

  const value = {
    session, user: session?.user || null, profile, loading, theme, textSize,
    recovery, endRecovery: () => setRecovery(false),
    signIn, signUp, signOut, setTheme, setTextSize, updateProfile, reloadProfile,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
