// Changing the day in the Medicine list must not move the week strip: a
// "Back to today" button that appeared under the date used to push the strip
// and every dose down by its own height on any day but today.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

test('the week strip stays put when the day changes', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await page.getByText('List', { exact: true }).click();
  const strip = page.locator('.daystrip').first();
  const top = () => strip.evaluate((e) => Math.round(e.getBoundingClientRect().top + window.scrollY));
  const onToday = await top();
  await strip.locator('button').first().click();
  await expect(page.getByRole('button', { name: 'Back to today' })).toBeVisible();
  expect(await top()).toBe(onToday);
  await page.getByRole('button', { name: 'Back to today' }).click();
  expect(await top()).toBe(onToday);
  await context.close();
});
