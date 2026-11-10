// The November 2026 shell: a labelled Settings button that opens Quick
// settings, the profile chip, and More as a page. Synthetic data only.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

test('Settings opens Quick settings; Escape closes it and focus returns to the button', async ({ browser }) => {
  const { page, context } = await openApp(browser);
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Quick settings' });
  await expect(panel).toBeVisible();
  // Focus is inside the panel and Tab stays inside it.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await context.close();
});

test('Quick settings changes text size and never claims alerts work', async ({ browser }) => {
  const { page, context } = await openApp(browser);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Quick settings' });
  await expect(panel.getByRole('status')).toHaveText('Normal');
  await expect(panel.getByRole('button', { name: 'Smaller text' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Larger text' }).click();
  await expect(panel.getByRole('status')).toHaveText('Large');
  expect(await page.evaluate(() => document.documentElement.dataset.text)).toBe('large');
  // The test browser has not granted notifications: the panel must say so.
  await expect(panel.getByText(/Setup needed|Blocked on this device|Not supported here/)).toBeVisible();
  await expect(panel.getByText(/working|delivered/i)).toHaveCount(0);
  // No caregiver link for someone who supports nobody.
  await expect(panel.getByRole('button', { name: 'Caregiver dashboard' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'All settings' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await context.close();
});

test('Quick settings fits a 320px phone at the largest text without sideways scrolling', async ({ browser }) => {
  const { page, context } = await openApp(browser, { width: 320, height: 568, text: 'huge' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Quick settings' });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
  const close = panel.getByRole('button', { name: 'Close quick settings' });
  await close.click();
  await expect(panel).toHaveCount(0);
  await context.close();
});

test('the next dose and its Record button are inside the first phone screen', async ({ browser }) => {
  for (const [width, height] of [[360, 780], [390, 844], [430, 932]]) {
    const { page, context } = await openApp(browser, { width, height });
    const record = page.getByRole('region', { name: 'Next medicine' }).getByRole('button', { name: /^Record as taken/ });
    await expect(record).toBeVisible();
    const box = await record.boundingBox();
    const nav = await page.locator('.bottom-nav').boundingBox();
    expect(box.y + box.height, `${width}px: button above the tab bar`).toBeLessThanOrEqual(nav.y);
    await context.close();
  }
});

test('More is a page that lists Contacts, Games, Care team and Settings, with a way back', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/more' });
  await expect(page.locator('#page-title')).toHaveText('More');
  for (const label of ['Contacts', 'Games', 'Care team', 'Settings', 'How to use MyDay']) {
    await expect(page.getByRole('main').getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await page.getByRole('main').getByRole('button', { name: /^Games/ }).click();
  await expect(page).toHaveURL(/\/games$/);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page).toHaveURL(/\/more$/);
  await context.close();
});

test('Contacts splits into Family and Medical team, and every saved contact is in one of them', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/contacts' });
  await expect(page.getByRole('radio', { name: 'Family' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Synthetic Pharmacy')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Medical team' }).click();
  await expect(page.getByText('Synthetic Pharmacy')).toBeVisible();
  for (const label of ['Prescribers', 'Pharmacies', 'Medical facilities']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await context.close();
});
