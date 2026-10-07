// P1: one status rule everywhere. Synthetic fixtures (test/e2e/mock.js):
// Oct 7 08:00 Metformin is still 'pending' on the server but past its
// 60-minute window; Oct 2–4 have stale 'pending' rows too.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

test('calendar, history list, Today and Home agree on missed doses', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await expect(page.locator('.today__headline')).toHaveText('1 dose missed today');
  await expect(page.locator('.card', { hasText: 'Synthetic Metformin' }).filter({ hasText: '8:00 AM' }).locator('.g-badge')).toContainText('Missed');

  await page.getByRole('tab', { name: 'History' }).click();
  await page.getByRole('radio', { name: 'Calendar' }).click();
  const oct7 = page.getByRole('button', { name: /Wednesday, October 7:/ });
  await expect(oct7).toHaveAttribute('aria-label', /1 missed/);
  await expect(oct7).not.toHaveAttribute('aria-label', /: to take/);
  for (const d of ['October 2', 'October 3', 'October 4']) {
    const cell = page.getByRole('button', { name: new RegExp(`, ${d}:`) });
    await expect(cell).toHaveAttribute('aria-label', /2 missed/);
    await expect(cell).toHaveAttribute('aria-label', /0 to take/);
  }
  // Future days are the plan, labelled as such — not empty.
  await expect(page.getByRole('button', { name: /October 9: planned — 4 doses scheduled/ })).toBeVisible();

  await page.getByRole('radio', { name: 'List' }).click();
  const oct3 = page.locator('section.g-day', { hasText: 'October 3' });
  await expect(oct3.locator('.g-badge--missed')).toHaveCount(2);

  await page.goto('/');
  await expect(page.locator('.stat--missed .stat__num')).toHaveText('1');
  await expect(page.getByRole('button', { name: /Wednesday, October 7:/ })).toHaveAttribute('aria-label', /1 missed/);
  await context.close();
});
