import { createContext, useContext, useEffect, useState } from 'react';
import { setClockPreference } from '../lib/format.js';

// Easy-use settings, kept on the device (localStorage) so they work offline
// and apply instantly. Visual ones become html[data-*] attributes in index.css.
export const SETTINGS_DEFAULTS = {
  bold: false,          // thicker text everywhere
  bigButtons: false,    // taller tap targets
  calmMotion: false,    // no animations
  clock: '12',          // '12' | '24' hour times
  weekStart: 'sun',     // 'sun' | 'mon' calendar week start
  homeCalendar: true,   // show the month calendar on the Home screen
  homeGames: true,      // show the brain-games card + reminder on Home
};

const KEY = 'myday_settings';

function load() {
  try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...SETTINGS_DEFAULTS }; }
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
