import { createContext, useContext, useEffect, useState } from 'react';
import { setClockPreference } from '../lib/format.js';

// Easy-use settings, kept on the device (localStorage) so they work offline
// and apply instantly. Visual ones become html[data-*] attributes in index.css.
export const SETTINGS_DEFAULTS = {
  bold: false,          // thicker text everywhere
  bigButtons: false,    // taller tap targets
  calmMotion: false,    // no animations
  highContrast: false,  // stronger text/borders on top of any theme
  clock: '12',          // '12' | '24' hour times
  homeCalendar: true,   // show the month calendar on the Home screen
  homeGames: true,      // show the brain-games card + reminder on Home
};

const KEY = 'myday_settings';

// Settings removed from the app are dropped on read so a value stored by an
// older build can never come back to life. `weekStart` went this way: calendars
// are now always Sunday-first.
const RETIRED_KEYS = ['weekStart'];

function load() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { stored = {}; }
  let pruned = false;
  for (const k of RETIRED_KEYS) {
    if (k in stored) { delete stored[k]; pruned = true; }
  }
  const next = { ...SETTINGS_DEFAULTS, ...stored };
  // Rewrite immediately, so the retired key is gone from the device even if the
  // person never changes another setting.
  if (pruned) { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {} }
  return next;
}

const SettingsCtx = createContext(null);
export const useSettings = () => useContext(SettingsCtx);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-bold', settings.bold ? '1' : '0');
    el.setAttribute('data-buttons', settings.bigButtons ? 'large' : 'normal');
    el.setAttribute('data-motion', settings.calmMotion ? 'calm' : 'full');
    el.setAttribute('data-contrast', settings.highContrast ? '1' : '0');
    setClockPreference(settings.clock);
  }, [settings]);

  function set(patch) {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  return <SettingsCtx.Provider value={{ settings, set }}>{children}</SettingsCtx.Provider>;
}
