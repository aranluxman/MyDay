// The November 2026 redesign: Today leads with medicines, wording records
// events instead of giving instructions, Appointments is always reachable,
// and empty diary fields never print "null". Synthetic data only.
import { test, expect } from '@playwright/test';
import { openApp, NOW } from './harness.js';
import { makeFixtures, USER_ID } from './mock.js';

test('a diary note with missing fields never shows "null" or "undefined"', async ({ browser }) => {
  const fixtures = makeFixtures(NOW);
  fixtures.myday_diary = [
    { id: 'n1', user_id: USER_ID, category: 'symptom', title: 'Headache', body: null, entry_at: '2026-10-07T12:00:00Z' },
    { id: 'n2', user_id: USER_ID, category: 'other', title: null, body: 'null', entry_at: '2026-10-06T12:00:00Z' },
  ];
  const { page, context } = await openApp(browser, { path: '/updates', fixtures });
  await expect(page.locator('.tl .card__title', { hasText: 'Headache' })).toBeVisible();
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\bnull\b|\bundefined\b/);
  await context.close();
});

test('Today puts the medicine list before the secondary cards, on every width', async ({ browser }) => {
  for (const [width, height] of [[390, 844], [820, 1180], [1180, 820], [1440, 900]]) {
    const { page, context } = await openApp(browser, { width, height, mobile: width < 1024 });
    const meds = page.getByRole('heading', { name: 'Today’s medicines' });
    await expect(meds).toBeVisible();
    const medsBox = await meds.boundingBox();
    const apptBox = await page.getByText('Next appointment', { exact: false }).first().boundingBox();
    // Beside it on a laptop (same row or lower), below it on narrower screens.
    if (width >= 1280) expect(apptBox.x).toBeGreaterThan(medsBox.x + medsBox.width);
    else expect(apptBox.y).toBeGreaterThan(medsBox.y);
    await context.close();
  }
});

test('a dose past its window says "Dose not recorded" and offers a review, not "Take"', async ({ browser }) => {
  const { page, context } = await openApp(browser, { width: 1440, height: 900, mobile: false });
  const row = page.locator('.tmed .drow', { hasText: 'Synthetic Metformin' }).filter({ hasText: '8:00 AM' });
  await expect(row.locator('.drow__flag')).toContainText('Dose not recorded');
  await expect(page.locator('main')).not.toContainText(/Take (this|these)/);
  await row.getByRole('button', { name: /Review dose: Synthetic Metformin, 8:00 AM/ }).click();
  await expect(row.getByText(/No dose was recorded for 8:00 AM/)).toBeVisible();
  await expect(row.getByRole('button', { name: 'I took it — record the time' })).toBeVisible();
  await context.close();
});

test('a recorded dose can be corrected later without a duplicate', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser, { width: 1440, height: 900, mobile: false });
  const btn = page.getByRole('button', { name: 'Mark as taken: Synthetic Vitamin D, 9:00 AM dose' });
  await btn.click();
  const row = page.locator('.tmed .drow', { hasText: 'Synthetic Vitamin D' });
  await expect(row.locator('.drow__done')).toBeVisible();
  await row.locator('.drow__btn').click();
  await row.getByRole('button', { name: 'Remove this record' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove record' }).click();
  await expect(page.getByRole('button', { name: 'Mark as taken: Synthetic Vitamin D, 9:00 AM dose' })).toBeVisible();
  const vitd = mock.db.myday_doses.filter((d) => d.medication_id === 'm-vitd' && d.dose_date === '2026-10-07');
  expect(vitd).toHaveLength(1);
  expect(vitd[0].status).not.toBe('taken');
  await context.close();
});

test('Appointments is one tap away at phone and tablet widths; Games and Settings are in More', async ({ browser }) => {
  for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [1180, 820]]) {
    const { page, context } = await openApp(browser, { width, height });
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Today', 'Medicines', 'Appointments', 'Health diary']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    if (width < 1024) {
      await nav.getByRole('button', { name: 'More' }).click();
      for (const label of ['Games', 'Settings', 'Help']) {
        await expect(page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
      }
    } else {
      for (const label of ['Games', 'Settings', 'Help']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await context.close();
  }
});

test('nothing fixed covers the dose buttons, and no page scrolls sideways', async ({ browser }) => {
  for (const [width, height] of [[390, 844], [768, 1024], [820, 1180], [834, 1194], [1024, 768], [1180, 820], [1280, 800], [1366, 768], [1440, 900]]) {
    const { page, context } = await openApp(browser, { width, height, mobile: width < 1024 });
    await expect(page.getByRole('heading', { name: 'Today’s medicines' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('.fab').count()).toBe(0);
    await context.close();
  }
});
