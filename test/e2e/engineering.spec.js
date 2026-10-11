import { test, expect, devices } from '@playwright/test';
import { openApp, NOW, BASE } from './harness.js';
import { makeFixtures, installMock } from './mock.js';
import { openNewMedicine, cont } from './helpers.js';

const sizes = [[360, 800], [390, 844], [430, 932]];
const reply = 'Thanks for adding that to your diary. What would you like to record next?';
const noteFixtures = () => {
  const fixtures = makeFixtures(NOW);
  fixtures.myday_diary = [{ id: 'note-1', user_id: fixtures.myday_profiles[0].user_id,
    title: 'A walk today', body: 'I enjoyed walking outside.', category: 'note', entry_at: new Date(NOW).toISOString() }];
  return fixtures;
};
async function zoom200(page) {
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
    window.visualViewport?.dispatchEvent(new Event('resize'));
  });
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

for (const [width, height] of sizes) for (const scaled of [false, true]) {
  const label = `${width}x${height}${scaled ? ' 200%' : ''}`;

  test(`${label}: guardian paste, backspace, prerequisites and expired-code recovery`, async ({ browser }) => {
    const fixtures = makeFixtures(NOW);
    fixtures.myday_profiles[0].full_name = '';
    const { page, context } = await openApp(browser, { width, height, path: '/guardian?from=alert', fixtures });
    let sends = 0;
    await page.route('**/functions/v1/guardian-data', async (route) => {
      if (route.request().postDataJSON()?.action !== 'account_link') return route.fallback();
      sends++;
      await route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ error: 'This code has expired. Ask for a new code.' }) });
    });
    const input = page.getByLabel('6-digit guardian code');
    await expect(input).toBeVisible();
    if (scaled) await zoom200(page);
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    await input.evaluate((el) => {
      const data = new DataTransfer(); data.setData('text', '12 34-56');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(input).toHaveValue('123456');
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
    await page.getByLabel('Your name', { exact: true }).fill('Family helper');
    await input.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('12345');
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
    await page.keyboard.type('6');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('expired');
    await expect(input).toHaveValue('123456');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('654321');
    expect(sends).toBe(1);
    await noOverflow(page);
    await context.close();
  });

  test(`${label}: wizard hierarchy, long names, draft preservation and reachable footer`, async ({ browser }) => {
    const { page, context } = await openApp(browser, { width, height, path: '/medication' });
    await openNewMedicine(page);
    if (scaled) await zoom200(page);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Add medicines', exact: true })).toBeVisible();
    await expect(page.getByText(/A medicine is unfinished/)).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('myday_med_batch')).length)).toBe(0);
    await page.getByRole('button', { name: 'Type a medicine' }).click();
    const name = 'Hydrochlorothiazide Extended Release Combination Medicine With A Very Long Name';
    await page.getByLabel('Medicine name', { exact: true }).fill(name);
    await cont(page);
    await expect(page.getByRole('dialog', { name: 'Add medicine', exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    // Reduced viewport simulates available space above an on-screen keyboard.
    await page.setViewportSize({ width, height: 400 });
    const foot = await page.locator('.wiz__foot').boundingBox();
    expect(foot.y + foot.height).toBeLessThanOrEqual(401);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.getByText(/A medicine is unfinished/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue medicine' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByLabel('Medicine name', { exact: true })).toHaveValue(name);
    await noOverflow(page);
    await context.close();
  });

  test(`${label}: configuration failure returns to diary without retry`, async ({ browser }) => {
    const { page, context } = await openApp(browser, { width, height, path: '/updates', fixtures: noteFixtures() });
    if (scaled) await zoom200(page);
    await page.route('**/functions/v1/ai-assist', (route) => route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'missing OPENAI_API_KEY' }) }));
    await page.getByRole('button', { name: 'Chat with MyDay' }).click();
    await expect(page.getByRole('alert')).toContainText('Chat is unavailable right now. You can still use your health diary.');
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await expect(page.getByText('missing OPENAI_API_KEY')).toHaveCount(0);
    await page.getByRole('button', { name: 'Return to health diary' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('A walk today', { exact: true })).toBeVisible();
    await noOverflow(page);
    await context.close();
  });
}

test('multi-turn chat keeps history, retries the failed turn once and preserves reading position', async ({ browser }) => {
  const { page, context, mock } = await openApp(browser, { path: '/updates', fixtures: noteFixtures() });
  const calls = [];
  let fail = false;
  let release;
  await page.route('**/functions/v1/ai-assist', async (route) => {
    const body = route.request().postDataJSON(); calls.push(body);
    if (body.message === 'Wait for this reply') await new Promise((resolve) => { release = resolve; });
    if (fail) {
      fail = false;
      return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'upstream outage', retryable: true }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: { reply: reply.repeat(8), suggestions: [], urgent: false } }) });
  });
  await page.getByRole('button', { name: 'Chat with MyDay' }).click();
  const input = page.getByLabel('Your message', { exact: true });
  await expect(input).toBeEnabled();
  expect(calls).toHaveLength(1);
  for (let i = 1; i <= 7; i++) {
    await input.fill(`Diary turn ${i}`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(input).toBeEnabled();
  }
  expect(calls[7].history).toHaveLength(13); // no lost turns after six exchanges
  fail = true;
  await input.fill('A failed turn');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).evaluate((b) => { b.click(); b.click(); });
  await expect(input).toBeEnabled();
  expect(calls.filter((c) => c.message === 'A failed turn')).toHaveLength(2);
  await expect(page.locator('.nchat__msg--me', { hasText: 'A failed turn' })).toHaveCount(1);
  await input.fill('Wait for this reply');
  await page.getByRole('button', { name: 'Send', exact: true }).evaluate((b) => { b.click(); b.click(); });
  await expect.poll(() => typeof release).toBe('function');
  await page.locator('.sheet__body').evaluate((el) => { el.scrollTop = 80; el.dispatchEvent(new Event('scroll')); });
  release();
  await expect(input).toBeEnabled();
  expect(calls.filter((c) => c.message === 'Wait for this reply')).toHaveLength(1);
  expect(await page.locator('.sheet__body').evaluate((el) => el.scrollTop)).toBeLessThan(100);
  await page.getByRole('button', { name: 'Save this to my note' }).evaluate((b) => { b.click(); b.click(); });
  await expect(page.getByRole('button', { name: 'Saved to your note' })).toBeVisible();
  expect(mock.calls.filter((c) => c.method === 'PATCH' && c.path === '/rest/v1/myday_diary')).toHaveLength(1);
  expect(mock.db.myday_diary[0].body).toContain('not clinical advice');
  await context.close();
});

test('permission is separate from subscription; saved device nicknames never identify this device', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile/notifications' });
  await expect(page.getByText('Will reminders reach me?')).toBeVisible();
  await expect(page.getByText('Not this device — 2 other devices are set up.')).toBeVisible();
  await expect(page.locator('.ns-med.is-current')).toHaveCount(0);
  await expect(page.locator('.ns-med', { hasText: 'iPhone' })).toBeVisible();
  await expect(page.locator('.ns-med', { hasText: 'Android device' })).toBeVisible();
  await expect(page.getByText(/Guardian alerts use each guardian/)).toBeVisible();
  await context.close();
});

test('legacy invite fallback keeps a rejected code and explains its expiry inline', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/guardian?invite=synthetic-expired-token' });
  await page.route('**/functions/v1/guardian-join', (route) => route.fulfill({ status: 410, contentType: 'application/json',
    body: JSON.stringify({ error: 'This code has expired. Ask for a new code.' }) }));
  await page.reload();
  await page.getByRole('button', { name: 'Type a code instead' }).click();
  const input = page.getByLabel('6-digit guardian code');
  await input.fill('123456');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(input).toHaveValue('123456');
  await input.fill('654321');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await context.close();
});

test('chat also refuses unsafe generated content from an older backend', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/updates', fixtures: noteFixtures() });
  await page.route('**/functions/v1/ai-assist', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    result: { reply: 'You probably have diabetes. Take 2 tablets.', suggestions: ['Double my dose'], urgent: false },
  }) }));
  await page.getByRole('button', { name: 'Chat with MyDay' }).click();
  await expect(page.locator('.nchat__msg--ai')).toContainText('cannot diagnose, prescribe, or advise on medicine doses');
  await expect(page.getByText('You probably have diabetes. Take 2 tablets.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Double my dose' })).toHaveCount(0);
  await context.close();
});

test('iPhone and Android install guidance uses the emulated platform', async ({ browser }) => {
  for (const device of ['iPhone 13', 'Pixel 7']) {
    const context = await browser.newContext({ ...devices[device], serviceWorkers: 'block' });
    const page = await context.newPage();
    await installMock(page, { now: NOW });
    await page.goto(BASE + '/profile');
    await page.getByRole('button', { name: /Download now|Add MyDay to this device|Install MyDay/ }).first().click();
    await expect(page.getByRole('dialog', { name: 'Add MyDay to your device' })).toBeVisible();
    await expect(page.getByText(device === 'iPhone 13' ? /Share button in Safari/ : /menu .*browser/).first()).toBeVisible();
    await context.close();
  }
});

test('push-service acceptance never claims receipt, and a disabled current subscription can be reconnected', async ({ browser }) => {
  const fixtures = makeFixtures(NOW);
  fixtures.myday_family_devices[0].push_enabled = false;
  fixtures.myday_medications[0].alert_window_override = 120;
  const { page, context } = await openApp(browser, { path: '/profile/notifications', fixtures });
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Object.defineProperty(navigator.serviceWorker, 'ready', { value: Promise.resolve({
      pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example.test/1' }) },
    }) });
  });
  await page.reload();
  await expect(page.getByText('This device allows notifications.')).toBeVisible();
  await expect(page.locator('.ns-med.is-current')).toContainText('iPhone');
  await expect(page.locator('.ns-med.is-current .contact__type')).toHaveText('This device');
  await expect(page.getByRole('button', { name: 'Turn on alerts on this device', exact: true })).toBeVisible();
  await expect(page.getByText(/Some medicines have their own window/)).toBeVisible();
  let accepted = 0;
  await page.route('**/functions/v1/missed-dose-check', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ delivered: accepted }) }));
  await page.getByRole('button', { name: 'Send a test alert' }).click();
  await expect(page.getByText(/test could not be sent to any notification service/)).toBeVisible();
  accepted = 1;
  await page.getByRole('button', { name: 'Send a test alert' }).click();
  await expect(page.getByText('Test alert sent to the notification service for 1 device.')).toBeVisible();
  await context.close();
});
