import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { ensureProfile, getProfile, saveProfile, refreshDoses } from '../lib/db.js';
import { deviceTimezone } from '../lib/format.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState(() => localStorage.getItem('myday_theme') || 'light');

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  const applyProfile = useCallback((p) => {
    setProfile(p);
    if (p?.theme) { setThemeState(p.theme); localStorage.setItem('myday_theme', p.theme); }
  }, []);

  // initial session + auth subscription
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
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
      } catch (e) { console.error(e); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [session?.user?.id, applyProfile]);

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
  }
  async function signUp(email, password, full_name) {
    const { data, error } = await supabase.functions.invoke('signup', { body: { email, password, full_name } });
    if (error) {
      let msg = 'Could not create the account.';
      try { const body = await error.context.json(); if (body?.error) msg = body.error; } catch {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    await signIn(email, password);
  }
  async function signOut() { await supabase.auth.signOut(); setProfile(null); }

  function setTheme(t) { setThemeState(t); localStorage.setItem('myday_theme', t); saveProfile({ theme: t }).catch(() => {}); }

  async function updateProfile(patch) {
    await saveProfile(patch);
    setProfile((p) => ({ ...p, ...patch }));
    if (patch.theme) setTheme(patch.theme);
  }
  async function reloadProfile() { const p = await getProfile(); applyProfile(p); return p; }

  const value = {
    session, user: session?.user || null, profile, loading, theme,
    signIn, signUp, signOut, setTheme, updateProfile, reloadProfile,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
