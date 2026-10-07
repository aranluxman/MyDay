// Phone layout checks from the audit, across the audited viewports and text
// sizes. These are responsive emulation in Chromium, not physical devices.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

const VIEWPORTS = [[320, 568], [360, 640], [390, 844], [430, 932], [844, 390], [390, 400]];
const TEXT = ['normal', 'huge'];
const PAGES = ['/', '/medication', '/profile', '/profile/notifications'];

async function settle(page) {
  await page.waitForSelector('main .stack');
  await page.waitForTimeout(400);
}

const overflow = (page) => page.evaluate(() => {
  const el = document.documentElement;
  const wide = [...document.querySelectorAll('main *')].filter((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(n).position !== 'fixed';
  }).slice(0, 3).map((n) => `${n.tagName}.${[...n.classList].join('.')}`);
  return { scroll: el.scrollWidth, client: el.clientWidth, wide };
});

const navCheck = (page) => page.evaluate(() => {
  const labels = [...document.querySelectorAll('.bottom-nav__label')].filter((l) => l.offsetParent !== null);
  const rects = labels.map((l) => l.getBoundingClientRect());
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i]; const b = rects[j];
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom && b.top < a.bottom) overlaps.push(`${labels[i].textContent}/${labels[j].textContent}`);
  }
  const clipped = labels.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent);
  // Effective rendered size: font-size times every zoom up the tree.
  const px = labels.map((l) => {
    let z = 1; for (let n = l; n; n = n.parentElement) z *= parseFloat(getComputedStyle(n).zoom) || 1;
    return parseFloat(getComputedStyle(l).fontSize) * z;
  });
  return { count: labels.length, overlaps, clipped, minPx: Math.min(...px) };
});

for (const [w, h] of VIEWPORTS) {
  for (const text of TEXT) {
    for (const path of PAGES) {
      test(`${w}x${h} ${text} ${path}`, async ({ browser }) => {
        const { page, context } = await openApp(browser, { width: w, height: h, text, path });
        await settle(page);
        const o = await overflow(page);
        expect.soft(o.scroll, `horizontal overflow; widest: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.client);
        if (w < 1024) {
          const n = await navCheck(page);
          expect.soft(n.overlaps, 'nav labels overlap').toEqual([]);
          expect.soft(n.clipped, 'nav labels clipped').toEqual([]);
          expect.soft(n.minPx, 'nav label size').toBeGreaterThanOrEqual(12);
        }
        if (path === '/profile/notifications') {
          await expect.soft(page.locator('.fab')).toHaveCount(0);
          const sw = page.getByRole('switch', { name: 'All notifications' });
          await sw.scrollIntoViewIfNeeded();
          const box = await sw.boundingBox();
          const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role="switch"]')?.textContent ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
          expect.soft(hit, 'All notifications switch reachable').not.toBeNull();
        }
        if (path === '/medication') {
          // Every action can be scrolled fully clear of the nav and Add button
          // and actually receives the tap there.
          const actions = page.locator('main .card button');
          const n = await actions.count();
          for (let i = 0; i < n; i++) {
            const b = actions.nth(i);
            if (!(await b.isVisible())) continue;
            await b.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
            const r = await b.evaluate((el) => {
              const box = el.getBoundingClientRect();
              const covers = [...document.querySelectorAll('.bottom-nav, .fab, .topbar')].map((o) => o.getBoundingClientRect())
                .filter((o) => o.width && box.left < o.right && o.left < box.right && box.top < o.bottom && o.top < box.bottom);
              const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
              return { covered: covers.length, own: el.contains(hit), label: el.textContent.trim().slice(0, 30), h: box.height };
            });
            expect.soft(r.covered, `"${r.label}" covered by an overlay`).toBe(0);
            expect.soft(r.own, `"${r.label}" does not receive the tap`).toBe(true);
          }
          // Full medicine names are readable, not cut off.
          const cut = await page.$$eval('main .card__title', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
          expect.soft(cut, 'truncated medicine names').toEqual([]);
        }
        await context.close();
      });
    }
  }
}

// Interactive targets on the core phone screens, at the default settings
// (no "Bigger buttons"). WCAG 2.5.5 asks for 44x44; calendar day cells are
// the one documented exception (2.5.8's 24px minimum still holds).
for (const path of ['/medication', '/profile/notifications', '/profile', '/']) {
  test(`hit areas at 320px on ${path}`, async ({ browser }) => {
    const { page, context } = await openApp(browser, { width: 320, height: 568, path });
    await settle(page);
    const small = await page.evaluate(() => {
      const sel = 'button, a[href], input:not([type=hidden]):not([type=file]), select, [role=switch], [role=tab], [role=radio]';
      return [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null && !el.closest('[inert]'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => r.width > 0 && (r.width < 44 || r.height < 44) && !el.classList.contains('skip-link'))
        .map(({ el, r }) => ({ name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), cal: !!el.closest('.cal__grid') }));
    });
    const real = small.filter((s) => !(s.cal && s.w >= 24 && s.h >= 24));
    expect(real, JSON.stringify(real)).toEqual([]);
    await context.close();
  });
}
