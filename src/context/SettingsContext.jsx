import { createContext, useContext, useEffect, useState } from 'react';
import { setClockPreference } from '../lib/format.js';

// Easy-use settings, kept on the device (localStorage) so they work offline
// and apply instantly. Visual ones become html[data-*] attributes in index.css.
export const SETTINGS_DEFAULTS = {
  bold: false,          // thicker text everywhere
  bigButtons: false,    // taller tap targets
  calmMotion: false,    // no animations
  highContrast: false,  // stronger text/borders on top of any theme
  clock: deviceClock(), // '12' | '24' hour times; follows the phone unless set by an older build
};

// The phone already knows whether its owner reads 2:30 PM or 14:30, so MyDay
// follows it instead of asking in Settings.
function deviceClock() {
  try {
    const opts = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    return opts.hour12 === false || opts.hourCycle === 'h23' || opts.hourCycle === 'h24' ? '24' : '12';
  } catch { return '12'; }
}

const KEY = 'myday_settings';

// Settings removed from the app are dropped on read so a value stored by an
// older build can never come back to life. `weekStart` went this way: calendars
// are now always Sunday-first. The Home calendar and brain-game nudge are now
// always shown, so their switches went too.
const RETIRED_KEYS = ['weekStart', 'homeCalendar', 'homeGames'];

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
