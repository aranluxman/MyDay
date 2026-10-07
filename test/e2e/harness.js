// Shared browser setup for the phone tests: frozen clock, Toronto timezone,
// service workers blocked, and the mock Supabase installed.
import { chromium } from '@playwright/test';
import { installMock } from './mock.js';

// Wednesday Oct 7, 2026, 9:30 AM in Toronto — matching the audit's "October 7".
export const NOW = Date.parse('2026-10-07T09:30:00-04:00');
export const BASE = process.env.MYDAY_BASE || 'http://localhost:4173';
export const executablePath = process.env.CHROME || '/opt/pw-browsers/chromium';

export async function launch() {
  return chromium.launch({ executablePath });
}

export async function openApp(browser, { base = BASE, width = 390, height = 844, text = 'normal', theme = 'light', path = '/', settings = {}, mobile = true, offline = false, fixtures } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
    timezoneId: 'America/Toronto', locale: 'en-CA', serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.clock.install({ time: NOW });
  const mock = await installMock(page, { now: NOW, fixtures });
  // The profile row wins over local storage, so set both.
  Object.assign(mock.db.myday_profiles[0], { text_size: text, theme });
  await page.addInitScript(([t, th, s]) => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('myday_settings', JSON.stringify({ calmMotion: true, ...s }));
        localStorage.setItem('myday_text', t);
        localStorage.setItem('myday_theme', th);
        sessionStorage.setItem('seeded', '1');
      }
    } catch {}
  }, [text, theme, settings]);
  await page.goto(base + path);
  if (offline) await context.setOffline(true);
  return { context, page, mock };
}
