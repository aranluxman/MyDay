// Before/after phone screenshots with identical synthetic data.
// Usage: node test/e2e/screenshots.mjs  (needs "before" on :4174, "after" on :4173)
import sharp from 'sharp';
import { launch, openApp } from './harness.js';

const OUT = new URL('../../docs/audit/screenshots/', import.meta.url).pathname;
const SCENES = [
  { id: '01-medication-320-largest', w: 320, h: 568, text: 'huge', path: '/medication' },
  { id: '02-profile-320-largest', w: 320, h: 568, text: 'huge', path: '/profile' },
  { id: '03-alerts-320', w: 320, h: 568, text: 'normal', path: '/profile/notifications' },
  { id: '04-medication-landscape-844x390', w: 844, h: 390, text: 'normal', path: '/medication',
    run: async (p) => { await p.evaluate(() => window.scrollBy(0, 230)); } },
  { id: '05-review-2.75mg-390', w: 390, h: 844, text: 'normal', path: '/medication',
    run: async (p) => {
      await p.getByRole('tab', { name: 'Medicines' }).click();
      await p.getByRole('button', { name: 'Add medicines' }).first().click();
      await p.getByRole('button', { name: 'Type a medicine' }).click();
      await p.locator('#wiz-name, input[aria-label="Medicine name"]').fill('Synthetic Liquid');
      await p.getByRole('button', { name: 'Continue', exact: true }).click();
      await p.getByRole('button', { name: 'mg', exact: true }).click();
      const amt = p.locator('#wiz-amount, input[aria-label="Amount in mg"]');
      await amt.fill('2.75'); await amt.blur();
      await p.getByRole('button', { name: 'Skip to the summary' }).click();
    } },
  { id: '06-history-calendar-390', w: 390, h: 844, text: 'normal', path: '/medication',
    run: async (p) => {
      await p.getByRole('tab', { name: 'History' }).click();
      await p.getByText('Calendar', { exact: true }).click();
      await p.waitForTimeout(400);
      await p.locator('.cal').scrollIntoViewIfNeeded();
      await p.getByRole('button', { name: /October 7/ }).click();
      await p.locator('.cal').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await p.evaluate(() => window.scrollBy(0, -70));
    } },
  { id: '07-settings-folded-390', w: 390, h: 844, text: 'normal', path: '/profile' },
];

const b = await launch();
for (const s of SCENES) {
  const shots = [];
  for (const [label, base] of [['Before', 'http://localhost:4174'], ['After', 'http://localhost:4173']]) {
    process.env.MYDAY_BASE = base;
    const { page, context } = await openApp(b, { width: s.w, height: s.h, text: s.text, path: s.path, base });
    await page.waitForSelector('main .stack').catch(() => {});
    await page.waitForTimeout(700);
    try { if (s.run) await s.run(page); } catch (e) { console.log(s.id, label, 'step failed:', e.message.split('\n')[0]); }
    await page.waitForTimeout(500);
    const file = `${OUT}${s.id}-${label.toLowerCase()}.png`;
    await page.screenshot({ path: file });
    shots.push({ file, label });
    await context.close();
  }
  // Side by side with a caption bar.
  const imgs = await Promise.all(shots.map((x) => sharp(x.file).metadata()));
  const W = imgs[0].width; const H = imgs[0].height; const gap = 24; const bar = 56;
  const svg = (t) => Buffer.from(`<svg width="${W}" height="${bar}"><rect width="100%" height="100%" fill="#111"/><text x="20" y="38" font-family="sans-serif" font-size="28" font-weight="700" fill="#fff">${t}</text></svg>`);
  await sharp({ create: { width: W * 2 + gap, height: H + bar, channels: 3, background: '#111' } })
    .composite([
      { input: svg('Before'), left: 0, top: 0 }, { input: shots[0].file, left: 0, top: bar },
      { input: svg('After'), left: W + gap, top: 0 }, { input: shots[1].file, left: W + gap, top: bar },
    ]).png().toFile(`${OUT}${s.id}.png`);
  console.log('wrote', s.id);
}
await b.close();
