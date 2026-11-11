// Phase 3: Medication safety, caregiver mode, Care team and "Remind me later".
// Synthetic data only; every request is answered by the in-memory mock.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

const ALL_CLEAR = /\b(safe to take|no interactions|all clear|no problems found|all safe)\b/i;

test('Medication safety says plainly that nothing was checked, and never gives an all-clear', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication/safety' });
  await expect(page.locator('#page-title')).toHaveText('Medication safety');
  for (const title of ['Interaction checker', 'Side-effect information', 'Nutrient information']) {
    const card = page.getByRole('region', { name: title });
    await expect(card).toContainText('Not checked · Service not connected');
    await expect(card).toContainText('your medicines have not been checked');
    await expect(card).toContainText('not the same as finding nothing');
  }
  expect(await page.getByRole('main').innerText()).not.toMatch(ALL_CLEAR);
  await expect(page.getByText('Information, not medical advice.')).toBeVisible();
  // The real route to a check: the full list for the pharmacist, and a call the person starts.
  const list = page.getByRole('region', { name: 'Medicine list for your pharmacist' });
  for (const name of ['Synthetic Metformin', 'Synthetic Vitamin D', 'Synthetic Acetaminophen']) await expect(list).toContainText(name);
  await expect(list).toContainText('Only when needed');
  await expect(list.getByRole('link', { name: /^Call Synthetic Pharmacy/ })).toHaveAttribute('href', 'tel:5550102000');
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
  await list.getByRole('button', { name: 'Print or save this list' }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await context.close();
});

test('Medication safety is linked from Medicines and from More', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('button', { name: 'Medication safety' }).click();
  await expect(page).toHaveURL(/\/medication\/safety$/);
  await page.goto('/more');
  await page.getByRole('main').getByRole('button', { name: /^Medication safety/ }).click();
  await expect(page).toHaveURL(/\/medication\/safety$/);
  await context.close();
});

async function caregiver(browser, { second = 'revoked' } = {}) {
  const opened = await openApp(browser);
  const { page, mock } = opened;
  const userId = mock.db.myday_profiles[0].user_id;
  await page.evaluate((id) => {
    localStorage.setItem(`myday_account_guardian_token:${id}:link-1`, 'synthetic-token');
    localStorage.setItem('myday_guardian_intro_seen', '1');
  }, userId);
  const med = (id) => mock.db.myday_medications.find((m) => m.id === id);
  const todays = mock.db.myday_doses.filter((d) => d.dose_date === '2026-10-07').map((d) => ({ ...d, medication: med(d.medication_id) }));
  const writes = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && !u.pathname.includes('/rpc/myday_refresh_doses') && !u.pathname.includes('/rpc/myday_features')) writes.push(`${r.method()} ${u.pathname}`);
  });
  const actions = [];
  await page.route('**/functions/v1/guardian-data', async (route) => {
    const body = route.request().postDataJSON();
    actions.push(body.action);
    if (body.action === 'account_list') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ links: [
        { id: 'link-1', name: 'Evelyn Parker', device_ids: ['link-1'] }, { id: 'link-2', name: 'Arthur Reed', device_ids: ['link-2'] }] }) });
    }
    if (body.link_id === 'link-2' && second === 'revoked') {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'This connection is no longer active.' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      patient: { name: body.link_id === 'link-2' ? 'Arthur Reed' : 'Evelyn Parker', timezone: 'America/Toronto', alert_window_minutes: 60 },
      guardian: { name: 'Sam' }, today: { date: '2026-10-07', doses: body.link_id === 'link-2' ? [] : todays }, history: [],
      appointments: [{ id: 'a', appt_date: '2026-10-08', appt_time: '10:30', doctor_name: 'Dr. Morgan' }], contacts: [],
      notifications: { push_enabled: false }, permissions: { read_only: true, can_read: [], can_write: [] },
    }) });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Manage' }).click();
  await expect(page.getByRole('heading', { name: 'People you support' })).toBeVisible();
  return { ...opened, writes, actions };
}

test('caregiver overview: records as words, a failed person is never shown as fine, and nothing can be recorded', async ({ browser }) => {
  const { page, context, writes } = await caregiver(browser);
  await expect(page.getByRole('note')).toContainText('Caregiver mode');
  await expect(page.getByRole('note')).toContainText('you cannot change it');
  const evelyn = page.getByRole('article', { name: 'Evelyn Parker' });
  await expect(evelyn).toContainText('View-only');
  await expect(evelyn).toContainText('0 of 4 doses recorded');
  await expect(evelyn).toContainText('8:00 AM dose: not recorded');
  await expect(evelyn).toContainText('9:00 AM dose: not recorded yet');
  await expect(evelyn).toContainText('Dr. Morgan, Tomorrow');
  await expect(evelyn).toContainText('Last synced 9:30');
  // Never "missed", "not taken" or "untaken" for a missing record.
  expect(await evelyn.innerText()).not.toMatch(/missed|not taken|untaken|forgot/i);
  // The person whose access was removed shows no numbers at all.
  const arthur = page.getByRole('article', { name: 'Arthur Reed' });
  await expect(arthur).toContainText('Could not update.');
  await expect(arthur).toContainText('nothing here is confirmed');
  await expect(arthur).not.toContainText('doses recorded');
  await expect(arthur.getByRole('button', { name: 'View day' })).toHaveCount(0);
  await expect(arthur.getByRole('button', { name: 'Try again' })).toBeVisible();
  // No control anywhere that records, reviews or changes a dose.
  await expect(page.getByRole('button', { name: /Record as taken|Review dose|Not today|I took|Remind me later|Add medicine|Edit/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /1 person has a dose with no record/ })).toBeVisible();

  // One person's day: a persistent banner says who, and that it is view-only.
  await evelyn.getByRole('button', { name: 'View day' }).click();
  const banner = page.locator('.cg-viewing');
  await expect(banner).toContainText('Viewing Evelyn Parker');
  await expect(banner).toContainText('View-only');
  await expect(page.getByText('Not recorded', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Record as taken|Review dose|Not today|I took|Remind me later/ })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 2000));
  await expect(banner).toBeInViewport();
  await banner.getByRole('button', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'People you support' })).toBeVisible();
  // Looking around wrote nothing to the person's data.
  expect(writes).toEqual([]);
  await context.close();
});

test('caregiver tabs: Alerts lists unrecorded doses with a caution; People has no way to invent a person', async ({ browser }) => {
  const { page, context, actions } = await caregiver(browser, { second: 'ok' });
  const nav = page.getByRole('navigation', { name: 'Caregiver navigation' });
  for (const label of ['Overview', 'People', 'Alerts', 'More']) await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Arthur Reed' })).toContainText('No medicines scheduled today');
  await nav.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.getByText('A missing record does not mean the dose was not taken')).toBeVisible();
  await expect(page.getByText('Evelyn Parker: Synthetic Metformin')).toBeVisible();
  await expect(page.getByText(/Delivery is not confirmed|Off on this device/).first()).toBeVisible();
  await nav.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByText('Only the person themselves can give you access.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Add dependant|Create/ })).toHaveCount(0);
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByText('You cannot record a dose, change a medicine or edit an appointment.')).toBeVisible();
  // Only read actions were ever sent to the guardian function.
  expect([...new Set(actions)].sort()).toEqual(['account_claim', 'account_dashboard', 'account_list'].filter((a) => actions.includes(a)).sort());
  await page.getByRole('button', { name: /Back to my own day/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await context.close();
});

test('Care team: My caregivers shows invitation state and scope; People I support is view-only', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser, { path: '/profile?section=guardians' });
  await expect(page.getByRole('heading', { name: 'Care team' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'My caregivers' })).toHaveAttribute('aria-checked', 'true');
  mock.db.myday_guardians.push({ id: 'g1', user_id: mock.db.myday_profiles[0].user_id, name: 'Maya Synthetic', phone: null, status: 'active', code: null, token: null,
    expires_at: null, code_expires_at: null, code_used_at: null, last_dashboard_at: null, share_diary: false, created_at: '2026-10-01T12:00:00Z' });
  await page.reload();
  const row = page.locator('.guardian').filter({ hasText: 'Maya Synthetic' });
  await expect(row).toContainText('Invitation pending');
  await expect(row).toContainText('Will be able to view: medicine records and appointments. View-only.');
  await expect(row.getByRole('button', { name: 'Remove Maya Synthetic' })).toBeVisible();
  await page.getByRole('radio', { name: 'People I support' }).click();
  await expect(page.getByText('You cannot add a person yourself.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add someone with their code' })).toBeVisible();
  await context.close();
});

test('"Remind me later" is hidden until the server supports it', async ({ browser }) => {
  const { page, context } = await openApp(browser);
  await expect(page.getByRole('region', { name: 'Next medicine' }).getByRole('button', { name: /^Record as taken/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remind me later/ })).toHaveCount(0);
  await context.close();
});

test('"Remind me later" postpones only the reminder: the dose time and status do not change', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser);
  mock.db.__remind_later = true;
  await page.reload();
  const before = { ...mock.db.myday_doses.find((d) => d.id.startsWith('d-m-vitd') && d.dose_date === '2026-10-07') };
  const later = page.getByRole('region', { name: 'Next medicine' }).getByRole('button', { name: /^Remind me later/ });
  await expect(later).toBeVisible();
  await later.click();
  await expect(page.locator('.toast')).toContainText('Reminder for Synthetic Vitamin D postponed to 9:45');
  await expect(page.locator('.toast')).toContainText('The dose time has not changed, and it is not recorded yet.');
  const after = mock.db.myday_doses.find((d) => d.id === before.id);
  expect(after.snoozed_until).toBeTruthy();
  expect({ status: after.status, due_at: after.due_at, scheduled_time: after.scheduled_time, taken_at: after.taken_at })
    .toEqual({ status: before.status, due_at: before.due_at, scheduled_time: before.scheduled_time, taken_at: before.taken_at });
  // Still shown as not recorded, and still recordable.
  await expect(page.getByRole('region', { name: 'Next medicine' }).getByRole('button', { name: /^Record as taken/ })).toBeVisible();
  await context.close();
});

test('phase 3 pages do not scroll sideways at 320px with the largest text', async ({ browser }) => {
  for (const path of ['/medication/safety', '/profile?section=guardians']) {
    const { page, context } = await openApp(browser, { width: 320, height: 568, text: 'huge', path });
    await page.waitForSelector('main .stack');
    await page.waitForTimeout(300);
    const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(o.s, path).toBeLessThanOrEqual(o.c);
    await context.close();
  }
});
