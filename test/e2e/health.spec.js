// Phase 2: Health tracker, Health profile and Reports. Synthetic data only;
// every request is answered by the in-memory mock.
import { test, expect } from '@playwright/test';
import { openApp, NOW } from './harness.js';
import { makeFixtures, USER_ID } from './mock.js';

const at = (daysAgo, hhmm) => {
  const day = new Date(NOW - daysAgo * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  return new Date(`${day}T${hhmm}:00-04:00`).toISOString();
};
function healthFixtures() {
  const f = makeFixtures(NOW);
  const row = (id, kind, value, unit, daysAgo, hhmm, extra = {}) => ({ id, user_id: USER_ID, kind, value, value2: null, unit, note: null, logged_at: at(daysAgo, hhmm), created_at: at(daysAgo, hhmm), ...extra });
  f.myday_health_logs = [
    row('h1', 'sleep', 440, 'min', 0, '07:00'),
    row('h2', 'sleep', 400, 'min', 2, '07:00'),
    row('h3', 'blood_pressure', 128, 'mmHg', 1, '08:30', { value2: 82 }),
    row('h4', 'water', 2, 'glass', 0, '08:00'),
    row('h5', 'water', 1, 'glass', 0, '09:00'),
  ];
  return f;
}

test('Health tracker shows the newest value with units and time, and "Not logged" for the rest', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/health', fixtures: healthFixtures() });
  const list = page.getByRole('list', { name: 'Measurements' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Water' })).toContainText('3 glasses');
  await expect(list.getByRole('listitem').filter({ hasText: 'Sleep' })).toContainText('7 h 20 min');
  await expect(list.getByRole('listitem').filter({ hasText: 'Sleep' })).toContainText('Today, 7:00');
  await expect(list.getByRole('listitem').filter({ hasText: 'Blood pressure' })).toContainText('128/82 mmHg');
  await expect(list.getByRole('listitem').filter({ hasText: 'Blood pressure' })).toContainText('Yesterday');
  // Never a blank or a zero for something that was not entered.
  await expect(list.getByRole('listitem').filter({ hasText: 'Weight' })).toContainText('Not logged');
  await expect(list.getByRole('listitem').filter({ hasText: 'Heart rate' })).toContainText('Not logged');
  await expect(list.getByRole('listitem').filter({ hasText: 'Mood' })).toContainText('Not logged today');
  await expect(page.getByText(/does not set targets or judge a reading/)).toBeVisible();
  await context.close();
});

test('blood pressure needs both numbers; a valid reading is saved with its unit and can be undone', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser, { path: '/health' });
  await page.getByRole('button', { name: 'Log blood pressure' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log blood pressure' });
  await dialog.getByLabel('Top number (systolic)').fill('128');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter the bottom number');
  await expect(dialog.getByLabel('Bottom number (diastolic)')).toBeFocused();
  expect(mock.db.myday_health_logs).toHaveLength(0);
  await dialog.getByLabel('Bottom number (diastolic)').fill('190');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('lower than the top number');
  await dialog.getByLabel('Bottom number (diastolic)').fill('82');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Saved. Blood pressure: 128/82 mmHg');
  expect(mock.db.myday_health_logs).toHaveLength(1);
  expect(mock.db.myday_health_logs[0]).toMatchObject({ kind: 'blood_pressure', value: 128, value2: 82, unit: 'mmHg' });
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => mock.db.myday_health_logs.length).toBe(0);
  await context.close();
});

test('sleep takes hours and minutes; weight keeps the unit that was typed', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser, { path: '/health' });
  await page.getByRole('button', { name: 'Log sleep' }).click();
  let dialog = page.getByRole('dialog', { name: 'Log sleep' });
  await dialog.getByLabel('Hours').fill('7');
  await dialog.getByLabel('Minutes').fill('75');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('0 to 59');
  await dialog.getByLabel('Minutes').fill('20');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Measurements' }).getByRole('listitem').filter({ hasText: 'Sleep' })).toContainText('7 h 20 min');
  expect(mock.db.myday_health_logs[0]).toMatchObject({ kind: 'sleep', value: 440, unit: 'min' });

  await page.getByRole('button', { name: 'Log weight' }).click();
  dialog = page.getByRole('dialog', { name: 'Log weight' });
  await dialog.getByRole('radio', { name: 'Pounds (lb)' }).click();
  await dialog.getByLabel('Weight in pounds').fill('150');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Weight' })).toContainText('Weight: 150 lb');
  expect(mock.db.myday_health_logs.find((r) => r.kind === 'weight')).toMatchObject({ value: 68.04, unit: 'lb' });
  await context.close();
});

test('trends leave a day without an entry empty, and an entry can be corrected or deleted', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser, { path: '/health', fixtures: healthFixtures() });
  await page.getByRole('tab', { name: 'Trends & history' }).click();
  await expect(page.getByText('Logged on 2 of 7 days.')).toBeVisible();
  const bars = page.getByRole('list', { name: 'Sleep, one item per day' });
  await expect(bars.getByRole('listitem')).toHaveCount(7);
  await expect(bars.getByText('Wednesday, October 7: 7 h 20 min')).toHaveCount(1);
  await expect(bars.getByText('Tuesday, October 6: no entry')).toHaveCount(1);
  await expect(page.getByText(/Average on the 2 days logged/)).toContainText('7 h');
  // Correct the older entry.
  await page.getByRole('button', { name: /^Edit sleep entry, 6 h 40 min/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit sleep' });
  await dialog.getByLabel('Hours').fill('8');
  await dialog.getByLabel('Minutes').fill('0');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => mock.db.myday_health_logs.find((r) => r.id === 'h2').value).toBe(480);
  // Delete asks first.
  await page.getByRole('button', { name: /^Delete sleep entry, 8 h/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => mock.db.myday_health_logs.some((r) => r.id === 'h2')).toBe(false);
  await context.close();
});

test('Diary and Health tracker switch between each other', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/updates' });
  await page.getByRole('radio', { name: 'Health tracker' }).click();
  await expect(page).toHaveURL(/\/health$/);
  await expect(page.locator('#page-title')).toHaveText('Health tracker');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Diary', exact: true })).toHaveClass(/is-active/);
  await page.getByRole('radio', { name: 'Notes' }).click();
  await expect(page).toHaveURL(/\/updates$/);
  await context.close();
});

test('Health profile: blanks say "Not entered", the editor validates, and "No known allergies" is its own answer', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser, { path: '/profile?section=health' });
  const list = page.locator('.hp-list');
  await expect(list).toContainText('Sam Synthetic');
  await expect(list.locator('.hp-row').filter({ hasText: 'Allergies' })).toContainText('Not entered');
  await expect(list.locator('.hp-row').filter({ hasText: 'Height' })).toContainText('Not entered');
  await expect(page.getByRole('status').filter({ hasText: 'details entered' })).toHaveText('2 of 7 details entered');
  await expect(page.getByText('%')).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit health profile' });
  await dialog.getByLabel('Gender').selectOption('woman');
  await dialog.getByLabel('Height in centimetres').fill('16');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('between 50 and 260 cm');
  expect(mock.db.myday_profiles[0].gender).toBeUndefined();
  await dialog.getByLabel('Height in centimetres').fill('165');
  await dialog.getByRole('radio', { name: 'lb' }).click();
  await dialog.getByLabel('Weight in pounds').fill('150');
  await dialog.getByLabel('No known allergies').check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  expect(mock.db.myday_profiles[0]).toMatchObject({ gender: 'woman', height_cm: 165, weight_kg: 68.04, weight_unit: 'lb', allergies_none: true, allergies: null });
  await expect(list.locator('.hp-row').filter({ hasText: 'Allergies' })).toContainText('No known allergies');
  await expect(list.locator('.hp-row').filter({ hasText: 'Weight' })).toContainText('150 lb');
  await expect(list.locator('.hp-row').filter({ hasText: 'Birth date' })).toContainText('76 years');
  await expect(page.getByRole('status').filter({ hasText: 'details entered' })).toHaveText('6 of 7 details entered');
  await context.close();
});

test('Reports totals match the records, name the denominator, and nothing is sent', async ({ browser }) => {
  const calls = [];
  const { page, context } = await openApp(browser, { path: '/reports', fixtures: healthFixtures() });
  page.on('request', (r) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) calls.push(`${r.method()} ${r.url()}`); });
  const report = page.getByRole('article', { name: 'Report preview' });
  await expect(report).toContainText('Sam Synthetic');
  await expect(report).toContainText('(7 days)');
  // Fixture, Oct 1-7 with a 60-minute window at 9:30 AM on Oct 7:
  //   taken 16, "Not today" 1, not recorded 8 (6 stale pending, 1 missed, today's 8:00) = 25 settled;
  //   3 of today's doses are still open.
  await expect(report).toContainText('16 of 25 scheduled doses recorded as taken');
  await expect(report).toContainText('16 recorded as taken');
  await expect(report).toContainText('8 not recorded');
  await expect(report).toContainText('3 doses are still open today and not counted');
  await expect(report).toContainText('it does not mean the dose was not taken');
  await expect(report.getByRole('row', { name: /^Blood pressure/ })).toContainText('1 of 7');
  await expect(report.getByRole('row', { name: /^Sleep/ })).toContainText('Average 7 h on the 2 days logged');
  await expect(report.getByRole('row', { name: /^Weight/ })).toContainText('No entries in this period');
  // Diary notes are off until the person ticks them.
  await expect(report.getByRole('heading', { name: 'Diary notes' })).toHaveCount(0);
  await page.getByLabel('Diary notes').check();
  await expect(report.getByRole('heading', { name: 'Diary notes' })).toBeVisible();
  await page.getByLabel('Medicines').uncheck();
  await expect(report.getByRole('heading', { name: 'Medication records' })).toHaveCount(0);
  // Saving is the device's print dialog; MyDay itself sends nothing.
  // (Requests before this point are the app's own start-up, e.g. making sure
  // today's doses exist; from here on, any write would be the report's doing.)
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
  calls.length = 0;
  await page.getByRole('button', { name: 'Save as PDF or print' }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await page.waitForTimeout(500);
  expect(calls).toEqual([]);
  await context.close();
});

test('an appointment keeps its optional notes', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser, { path: '/appointments' });
  await page.getByRole('button', { name: /Dr\. Synthetic/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit appointment' });
  await dialog.getByLabel('Notes (optional)').fill('Bring the blood pressure log.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => mock.db.myday_appointments[0].notes).toBe('Bring the blood pressure log.');
  await page.getByRole('button', { name: /Dr\. Synthetic/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Bring the blood pressure log.');
  await context.close();
});

test('phase 2 pages do not scroll sideways at 320px with the largest text', async ({ browser }) => {
  for (const path of ['/health', '/reports', '/profile?section=health']) {
    const { page, context } = await openApp(browser, { width: 320, height: 568, text: 'huge', path, fixtures: healthFixtures() });
    await page.waitForSelector('main .stack');
    await page.waitForTimeout(300);
    const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(o.s, path).toBeLessThanOrEqual(o.c);
    await context.close();
  }
});
