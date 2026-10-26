import { test, expect } from '@playwright/test';
import { installMock, fakeSession } from './mock.js';

const KEY = 'sb-cthpunnnkdgukuogyvxm-auth-token';

async function prepare(page, { expired = true } = {}) {
  const mock = await installMock(page, { now: Date.now(), seedSession: false });
  const session = fakeSession();
  if (expired) {
    session.expires_at = Math.floor(Date.now() / 1000) - 3600;
    session.refresh_token = 'synthetic-old-refresh';
  }
  // Seed once, so reloads exercise actual SDK persistence rather than fixtures.
  await page.addInitScript(([key, s]) => {
    if (!sessionStorage.getItem('session-fixture-seeded')) {
      localStorage.setItem(key, JSON.stringify(s));
      sessionStorage.setItem('session-fixture-seeded', '1');
    }
  }, [KEY, session]);
  return mock;
}

test('expired access token refreshes and survives reload without asking for credentials', async ({ page }) => {
  const mock = await prepare(page);
  await page.goto('/profile');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  expect(mock.calls.some((c) => c.path === '/auth/v1/token' && c.search.includes('refresh_token'))).toBe(true);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).refresh_token, KEY)).toBe('synthetic-refresh');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  expect(mock.calls.some((c) => c.search.includes('grant_type=password'))).toBe(false);
});

test('offline reopen retains stored session and reconnects without sign-in', async ({ page }) => {
  test.setTimeout(120_000);
  const mock = await prepare(page);
  let offline = true;
  await page.route('**/auth/v1/token*', (route) => offline ? route.abort('internetdisconnected') : route.fallback());
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Let’s reconnect' })).toBeVisible({ timeout: 90_000 });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).refresh_token, KEY)).toBe('synthetic-old-refresh');
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Try again' }).click();
  // The SDK intentionally caches refresh failures for up to 60 seconds.
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({ timeout: 75_000 });
  expect(mock.calls.some((c) => c.search.includes('grant_type=password'))).toBe(false);
});

test('revoked refresh token still requires a real sign-in', async ({ page }) => {
  await prepare(page);
  await page.route('**/auth/v1/token*', (route) => route.fulfill({
    status: 400, contentType: 'application/json',
    body: JSON.stringify({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }),
  }));
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await expect(page.getByRole('heading', { name: 'Let’s reconnect' })).toHaveCount(0);
});

test('deliberate sign-out clears storage and reconnect cannot resurrect it', async ({ page }) => {
  const mock = await prepare(page, { expired: false });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  expect(mock.calls.find((c) => c.path === '/auth/v1/logout')?.search).toContain('scope=local');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('failed sign-out keeps the account visible and reports the failure', async ({ page }) => {
  await prepare(page, { expired: false });
  await page.route('**/auth/v1/logout*', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Service unavailable' }),
  }));
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Could not sign out. Check your connection and try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).not.toBeNull();
});
