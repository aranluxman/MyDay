// Redesign phase 2: the Medicines page opens on today (side by side with a
// compact calendar where there is room), the calendar works from the
// keyboard, adding one medicine goes straight into the form, and reminders
// show their three separate answers. Synthetic data only.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';
import { openNewMedicine, nameAndAmount, cont, stepTitle } from './helpers.js';

test('wide screens put the day beside a compact calendar; narrower ones open on today', async ({ browser }) => {
  for (const [width, height, split] of [[1440, 900, true], [1180, 820, true], [1024, 768, false], [820, 1180, false], [390, 844, false]]) {
    const { page, context } = await openApp(browser, { width, height, path: '/medication', mobile: width < 1024 });
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    if (split) {
      await expect(page.locator('.med-split .cal')).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Calendar' })).toHaveCount(0);
      // The doses come first in reading order, the calendar beside them.
      const day = await page.locator('.med-split__day').boundingBox();
      const cal = await page.locator('.med-split__cal').boundingBox();
      expect(cal.x).toBeGreaterThan(day.x + day.width - 1);
    } else {
      await expect(page.getByRole('radio', { name: 'Today' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('.daystrip')).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await context.close();
  }
});

test('the calendar works from the keyboard and says which day is shown', async ({ browser }) => {
  const { page, context } = await openApp(browser, { width: 1440, height: 900, path: '/medication', mobile: false });
  const grid = page.locator('.med-split .cal__grid');
  // Only one day is in the Tab order: the selected one.
  await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
  await grid.getByRole('button', { name: /^Wednesday, October 7/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(grid.getByRole('button', { name: /^Thursday, October 8/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Tomorrow' })).toBeVisible();
  await expect(page.locator('.med-split .cal [aria-live]').first()).toHaveText(/Showing .*October 8/);
  await page.keyboard.press('PageDown');
  await expect(grid.getByRole('button', { name: /^Sunday, November 8:/ })).toBeFocused();
  await expect(page.locator('.med-split .cal__title')).toHaveText('November 2026');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Home');
  await expect(grid.getByRole('button', { name: /^Sunday, November 1:/ })).toBeFocused();
  await context.close();
});

test('Add opens the form straight away and saves one medicine', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  const before = mock.db.myday_medications.length;
  await openNewMedicine(page);
  await expect(page.getByRole('dialog', { name: 'Add medicines' })).toHaveCount(0);
  await nameAndAmount(page, 'Example medicine A', '1', 'tablet');
  await page.getByRole('button', { name: /Evening/ }).click();
  await page.getByRole('button', { name: 'Skip to the summary' }).click();
  await expect(stepTitle(page)).toHaveText('Does this look right?');
  await page.getByRole('button', { name: 'Save medicine' }).click();
  await expect(page.locator('.toast').first()).toContainText('Example medicine A added: 1 tablet');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mock.db.myday_medications.length).toBe(before + 1);
  await context.close();
});

test('"Save and add another" saves, then opens a blank form for the next one', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  const before = mock.db.myday_medications.length;
  await openNewMedicine(page);
  await nameAndAmount(page, 'Example medicine B', '2', 'tablet');
  await page.getByRole('button', { name: /Evening/ }).click();
  await page.getByRole('button', { name: 'Skip to the summary' }).click();
  await page.getByRole('button', { name: 'Save and add another' }).click();
  await expect(page.locator('.toast').first()).toContainText('Example medicine B added');
  await expect(stepTitle(page)).toHaveText('What is it called?');
  await expect(page.locator('#wiz-name')).toHaveValue('');
  await expect(page.getByText('We kept what you typed last time.')).toHaveCount(0);
  expect(mock.db.myday_medications.length).toBe(before + 1);
  await context.close();
});

test('Skip to the summary never skips a missing name', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await openNewMedicine(page);
  await page.getByRole('button', { name: 'Skip to the summary' }).click();
  await expect(stepTitle(page)).toHaveText('What is it called?');
  await expect(page.locator('#wiz-name')).toBeFocused();
  await expect(page.locator('#wiz-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Save medicine' })).toHaveCount(0);
  await page.locator('#wiz-name').fill('Example medicine C');
  await cont(page);
  await expect(stepTitle(page)).toHaveText('How much do you take?');
  await context.close();
});

test('Reminders shows three separate answers and never asks for permission by itself', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await page.evaluate(() => { window.__asked = 0; });
  await page.addInitScript(() => {
    window.__asked = 0;
    if (window.Notification) {
      const real = window.Notification.requestPermission?.bind(window.Notification);
      window.Notification.requestPermission = (...a) => { window.__asked += 1; return real?.(...a); };
    }
  });
  await page.reload();
  const card = page.locator('.remind-card');
  await expect(card.getByRole('heading', { name: 'Reminders' })).toBeVisible();
  await expect(card.locator('.remind-line')).toHaveCount(3);
  await expect(card).toContainText('MyDay reminders: On');
  await expect(card).toContainText('This device:');
  await expect(card).toContainText('Test alert: Not checked');
  await expect(card.getByRole('switch', { name: /MyDay reminders/ })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__asked)).toBe(0);
  // Switching MyDay reminders off says so in words, not only by the switch.
  await card.getByRole('switch', { name: /MyDay reminders/ }).click();
  await expect(card).toContainText('MyDay reminders: Off');
  await context.close();
});
