// Dose logging against the mock's idempotent RPCs (the real SQL is tested in
// test/sql/0017_test.sql). Synthetic data only.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

const rpcCalls = (mock, fn) => mock.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);

test('a double tap records one dose and the confirmation says exactly what', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  const btn = page.getByRole('button', { name: 'Done - I took it: Synthetic Vitamin D, 9:00 AM dose' });
  await btn.dblclick();
  const toast = page.locator('.toast').first();
  await expect(toast).toContainText('Recorded: Synthetic Vitamin D 1000 IU — 9:00 AM dose, taken at 9:30');
  expect(rpcCalls(mock, 'myday_take_dose')).toHaveLength(1);
  const dose = mock.db.myday_doses.find((d) => d.id.startsWith('d-m-vitd') && d.dose_date === '2026-10-07');
  expect(dose.status).toBe('taken');

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(btn).toBeVisible();
  expect(rpcCalls(mock, 'myday_untake_dose')).toHaveLength(1);
  expect(dose.status).toBe('pending');
  await context.close();
});

test('stock goes down once on taken and comes back on undo', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  const met = mock.db.myday_medications.find((m) => m.id === 'm-met');
  await page.getByRole('button', { name: 'Done - I took it: Synthetic Metformin, 8:00 AM dose' }).click();
  await expect(page.locator('.toast').first()).toContainText('Recorded: Synthetic Metformin');
  expect(met.stock_quantity).toBe(29);
  await page.locator('.toast').first().getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Done - I took it: Synthetic Metformin, 8:00 AM dose' })).toBeVisible();
  expect(met.stock_quantity).toBe(30);
  await context.close();
});

test('"I took it earlier" records the actual time, separate from the scheduled time', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  await page.locator('.card', { hasText: 'Synthetic Metformin' }).filter({ hasText: '8:00 AM' })
    .getByRole('button', { name: 'I took it earlier' }).click();
  await page.getByLabel('Type a time').fill('08:12');
  await page.getByRole('button', { name: 'Use 8:12 AM' }).click();
  await expect(page.locator('.toast').first()).toContainText('8:00 AM dose, taken at 8:12');
  const call = rpcCalls(mock, 'myday_take_dose')[0];
  expect(new Date(call.body.p_taken_at).toISOString()).toBe(new Date('2026-10-07T08:12:00-04:00').toISOString());
  await context.close();
});

test('offline: nothing is reported as saved', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  await expect(page.locator('.today__headline')).toBeVisible();
  mock.setOffline(true);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.offline-bar')).toContainText('Nothing you tap is saved');
  await page.getByRole('button', { name: 'Done - I took it: Synthetic Vitamin D, 9:00 AM dose' }).click();
  await expect(page.locator('.toast--bad')).toContainText(/offline.*NOT saved|Nothing was recorded/);
  await expect(page.locator('.toast--good')).toHaveCount(0);
  const dose = mock.db.myday_doses.find((d) => d.id.startsWith('d-m-vitd') && d.dose_date === '2026-10-07');
  expect(dose.status).toBe('pending');
  await context.close();
});

test('as-needed medicines can be logged once per tap, with Undo', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  const card = page.locator('.card', { hasText: 'Synthetic Acetaminophen' });
  await card.getByRole('button', { name: 'I took one just now' }).dblclick();
  await expect(page.locator('.toast').first()).toContainText('Recorded: Synthetic Acetaminophen 1 tablet, taken at 9:30');
  expect(rpcCalls(mock, 'myday_log_prn_dose')).toHaveLength(1);
  await expect(card).toContainText('Taken today at 9:30');
  // Never counted in the scheduled summary.
  await expect(page.locator('.today__headline')).toHaveText('1 dose missed today');
  await context.close();
});

test('removing a medicine names it, keeps history, and can be undone', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('tab', { name: 'Medicines' }).click();
  await page.locator('.medlist__summary', { hasText: 'Synthetic Vitamin D' }).click();
  await page.getByRole('button', { name: 'Remove Synthetic Vitamin D' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Remove Synthetic Vitamin D (1000 IU)?' });
  await expect(confirm).toContainText('Doses you already recorded are kept');
  await confirm.getByRole('button', { name: 'Remove Synthetic Vitamin D' }).click();
  await expect(page.locator('.toast').first()).toContainText('Synthetic Vitamin D removed.');
  expect(mock.db.myday_medications.find((m) => m.id === 'm-vitd').active).toBe(false);
  expect(mock.db.myday_doses.filter((d) => d.medication_id === 'm-vitd' && d.status === 'taken').length).toBeGreaterThan(0);
  await page.locator('.toast').first().getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.medlist__summary', { hasText: 'Synthetic Vitamin D' })).toBeVisible();
  await context.close();
});

test('Copy opens a review and saves nothing until confirmed', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('tab', { name: 'Medicines' }).click();
  await page.locator('.medlist__summary', { hasText: 'Synthetic Vitamin D' }).click();
  const before = mock.db.myday_medications.length;
  await page.getByRole('button', { name: 'Copy Synthetic Vitamin D' }).click();
  await expect(page.locator('.wiz__title')).toHaveText('Does this look right?');
  await expect(page.locator('.aiscan-note')).toContainText('This is a copy of Synthetic Vitamin D');
  expect(mock.db.myday_medications.length).toBe(before);
  await page.getByRole('button', { name: 'Add this medicine' }).click();
  await expect(page.locator('.toast').first()).toContainText('Synthetic Vitamin D (copy) added: 1000 IU');
  expect(mock.db.myday_medications.length).toBe(before + 1);
  await context.close();
});
