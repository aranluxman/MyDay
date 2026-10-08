import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

test('a morning completion survives reopening and evening has its own dose', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  const morning = page.getByRole('button', { name: 'Done - I took it: Synthetic Metformin, 8:00 AM dose' });
  await morning.click();
  await expect(page.locator('.toast').first()).toContainText('Recorded: Synthetic Metformin');
  const recorded = mock.db.myday_doses.find((d) => d.medication_id === 'm-met' && d.dose_date === '2026-10-07' && d.scheduled_time === '08:00');
  const timestamp = recorded.taken_at;
  await page.clock.fastForward(10 * 3600_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(morning).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done - I took it: Synthetic Metformin, 8:00 PM dose' })).toBeVisible();
  await page.reload();
  await expect(morning).toHaveCount(0);
  expect(recorded.status).toBe('taken');
  expect(recorded.taken_at).toBe(timestamp);
  await context.close();
});

test('history date dropdown shows all medicines on only the selected day', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  const date = page.getByLabel('Medication history date');
  await expect(date).toBeVisible();
  await page.getByRole('button', { name: 'Taken', exact: true }).click();
  await date.selectOption('2026-10-06');
  await expect(page.locator('.g-day')).toHaveCount(1);
  const expected = mock.db.myday_doses.filter((d) => d.dose_date === '2026-10-06');
  await expect(page.locator('.g-day .g-list > li')).toHaveCount(expected.length);
  await date.selectOption('2026-10-07');
  await expect(page.locator('.g-day')).toHaveCount(1);
  await expect(page.locator('.g-day__title')).toHaveText('Today');
  await context.close();
});

test('phone navigation opens Games directly and Profile from More', async ({ browser }) => {
  const { page, context } = await openApp(browser, { settings: { homeGames: false } });
  await expect(page.getByRole('button', { name: /Brain Games/ }).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Games', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Profile', exact: true })).toBeHidden();
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Profile/ }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await context.close();
});

test('guardian can choose every delay, save a set time, and filter history by date', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser);
  const userId = mock.db.myday_profiles[0].user_id;
  const notifications = { push_enabled: true, alert_mode: 'delay', alert_delay_minutes: 60, alert_at: '19:00' };
  const writes = [];
  await page.evaluate((id) => {
    localStorage.setItem(`myday_account_guardian_token:${id}:link-1`, 'synthetic-token');
    localStorage.setItem('myday_guardian_intro_seen', '1');
  }, userId);
  await page.route('**/functions/v1/guardian-data', async route => {
    const body = route.request().postDataJSON();
    let response;
    if (body.action === 'account_list') response = { links: [{ id: 'link-1', name: 'Test patient', device_ids: ['link-1'] }] };
    else if (body.action === 'alert_timing') {
      writes.push(body);
      Object.assign(notifications, { alert_mode: body.mode, alert_delay_minutes: body.delay_minutes, alert_at: body.at });
      response = { ok: true };
    } else response = {
      patient: { name: 'Test patient', timezone: 'America/Toronto', alert_window_minutes: 60 },
      guardian: { name: 'Sam' }, today: { date: '2026-10-07', doses: [] },
      history: mock.db.myday_doses.map(d => ({ ...d, medication: mock.db.myday_medications.find(m => m.id === d.medication_id) })),
      notifications, permissions: { read_only: true, can_read: [], can_write: [] },
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('http://localhost:4173/guardian');
  await page.getByRole('button', { name: 'Check on Test patient' }).click();
  const delay = page.getByLabel('How long after the dose is due?');
  for (const minutes of [15, 30, 45, 60]) {
    await delay.selectOption(String(minutes));
    await expect(delay).toBeEnabled();
    await expect(delay).toHaveValue(String(minutes));
    expect(writes.at(-1).delay_minutes).toBe(minutes);
  }
  await page.getByLabel('When a medicine has not been taken').selectOption('time');
  const time = page.getByLabel('Check for untaken medicines at');
  await time.fill('18:45');
  await page.getByRole('button', { name: 'Save alert time' }).click();
  await expect(time).toBeEnabled();
  expect(writes.at(-1)).toMatchObject({ mode: 'time', at: '18:45' });
  await page.getByRole('radio', { name: 'History', exact: true }).click();
  await page.getByLabel('Medication history date').selectOption('2026-10-06');
  await expect(page.locator('.g-day')).toHaveCount(1);
  await expect(page.locator('.g-day .g-list > li')).toHaveCount(mock.db.myday_doses.filter(d => d.dose_date === '2026-10-06').length);
  await context.close();
});
