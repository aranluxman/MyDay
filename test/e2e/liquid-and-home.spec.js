// The Liquid Glass controls, the laptop side rail, the Call fix, the guide's
// "Show me" buttons, the customizable Home and medicine questions.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

const LAPTOPS = [[1280, 720], [1366, 768]];

for (const [width, height] of LAPTOPS) {
  test(`every page is reachable from the side rail at ${width}x${height}`, async ({ browser }) => {
    const { page, context } = await openApp(browser, { width, height, mobile: false });
    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Home', 'Medicine', 'Updates', 'Visits', 'Games', 'Profile']) {
      await expect(rail.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // My cards is gone, and Alerts is a section of Profile rather than a page.
    await expect(rail.getByRole('link', { name: 'My cards' })).toHaveCount(0);
    await expect(rail.getByRole('link', { name: 'Alerts' })).toHaveCount(0);
    await rail.getByRole('link', { name: 'Profile', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('switch', { name: 'All notifications' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    // The last thing on the page can be scrolled into view and is not under the rail.
    const last = page.locator('main .stack > *').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const box = await last.boundingBox();
    const railBox = await rail.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(railBox.x + railBox.width - 1);
    const sw = page.getByRole('switch', { name: 'All notifications' });
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    await expect(sw).not.toHaveAttribute('aria-checked', before);
    await context.close();
  });
}

test('sliding a finger along the tab bar moves the glass and opens the tab it stops on', async ({ browser }) => {
  const { page, context } = await openApp(browser, { mobile: false });
  const nav = page.locator('.bottom-nav');
  const b = await nav.boundingBox();
  const target = await page.locator('.bottom-nav__item', { hasText: 'Updates' }).boundingBox();
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + 40, y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(b.x + 40 + ((target.x + target.width / 2 - b.x - 40) * i) / steps, y);
  await expect(nav).toHaveClass(/is-dragging/);
  await page.waitForTimeout(150); // a still finger: no momentum
  await page.mouse.up();
  await expect(page).toHaveURL(/\/updates$/);
  const lens = await page.locator('.bottom-nav__ind').boundingBox();
  const active = await page.locator('.bottom-nav__item.is-active').boundingBox();
  expect(Math.abs(lens.x - active.x)).toBeLessThan(2);
  // A plain tap still works.
  await page.locator('.bottom-nav__item', { hasText: 'Games' }).click();
  await expect(page).toHaveURL(/\/games$/);
  await context.close();
});

test('a switch can be slid, tapped or flipped from the keyboard', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile' });
  await page.getByRole('button', { name: /^Accessibility/ }).click();
  const sw = page.getByRole('switch', { name: 'Bold text' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  const box = await sw.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 14, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 14 + i * 5, y);
  await page.mouse.up();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.focus();
  await page.keyboard.press('Space');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await context.close();
});

test('a visit with no doctor never offers to call a contact’s number', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/' });
  mock.db.myday_contacts.push({ id: 'c-short', user_id: mock.db.myday_profiles[0].user_id, name: 'Mom', type: 'other', phone: '467' });
  mock.db.myday_appointments.push({ id: 'a-none', user_id: mock.db.myday_profiles[0].user_id, appt_date: mock.db.myday_appointments[0].appt_date, appt_time: '15:00', doctor_name: null, location: 'Lab', reason: 'Blood test' });
  await page.goto('/appointments');
  const card = page.locator('.appt', { hasText: 'Blood test' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: 'Call' })).toHaveCount(0);
  await expect(page.locator('a[href="tel:467"]')).toHaveCount(0);
  await context.close();
});

test('the guide’s "Open Guardians" opens and scrolls to Guardians', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile' });
  await page.getByRole('button', { name: /^How to use MyDay/ }).click();
  await page.getByRole('button', { name: /Letting family keep an eye out/ }).click();
  await page.getByRole('button', { name: 'Open Guardians' }).click();
  const fold = page.locator('#fold-guardians');
  await expect(fold.getByRole('button', { name: /^Guardians/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(fold).toBeInViewport();
  await context.close();
});

test('Home can be rearranged, and a mood tap is saved with Undo', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser);
  await page.getByRole('button', { name: 'Edit Home' }).click();
  await page.getByRole('switch', { name: 'Quick calls' }).click();
  await page.getByRole('switch', { name: 'This week' }).click();
  await page.getByRole('button', { name: 'Move Next visit up' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('region', { name: 'Quick calls' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Medicines this week' })).toBeVisible();
  await page.reload();
  await page.waitForSelector('.home-grid');
  await expect(page.getByRole('region', { name: 'Quick calls' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Medicines this week' })).toBeVisible();
  const order = await page.locator('.home-w').evaluateAll((els) => els.map((e) => e.className.match(/home-w--(\w+)/)[1]));
  expect(order.indexOf('nextVisit')).toBeLessThan(order.indexOf('today'));

  await page.getByRole('button', { name: 'Okay' }).click();
  await expect(page.getByText('Today you felt: Okay')).toBeVisible();
  expect(mock.db.myday_diary.map((d) => d.title)).toContain('Feeling okay');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: 'How are you feeling today?' })).toBeVisible();
  expect(mock.db.myday_diary.map((d) => d.title)).not.toContain('Feeling okay');
  await context.close();
});

test('System appearance follows the device', async ({ browser }) => {
  const { page, context } = await openApp(browser, { theme: 'system', path: '/profile' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /^Appearance/ }).click();
  await page.getByRole('radio', { name: 'Dark' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await context.close();
});

test('asking about medicines says it is not medical advice', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication/ask' });
  await expect(page.getByRole('note')).toContainText('Not medical advice');
  await expect(page.getByText('This is general information, not medical advice.')).toBeVisible();
  await page.route('**/functions/v1/ai-assist', (r) => r.fulfill({ json: { result: { reply: 'You should stop the vitamin D.', suggestions: [], urgent: false } } }));
  await page.getByRole('button', { name: 'What is each one for?' }).click();
  // Even if a server slipped one through, the app refuses to show a dose instruction.
  await expect(page.locator('.nchat__log').getByText(/can't tell you how much to take/)).toBeVisible();
  await context.close();
});

test('quick calls dial saved contacts, offer to add a missing one, and 911 asks first', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser);
  const uid = mock.db.myday_profiles[0].user_id;
  mock.db.myday_contacts.push({ id: 'c-doc', user_id: uid, name: 'Dr. Synthetic', type: 'provider', phone: '(555) 123-4567' });
  await page.reload();
  const quick = page.getByRole('region', { name: 'Quick calls' });
  await expect(quick.getByRole('link', { name: /^Call Doctor: Dr\. Synthetic/ })).toHaveAttribute('href', 'tel:5551234567');
  // Nothing dials 911 on a single tap.
  await expect(page.locator('a[href="tel:911"]')).toHaveCount(0);
  await quick.getByRole('button', { name: 'Emergency' }).click();
  const sos = page.getByRole('dialog', { name: 'Call 911?' });
  await expect(sos.getByRole('link', { name: 'Call 911 now' })).toHaveAttribute('href', 'tel:911');
  await sos.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // No family number saved: the tile opens the contact form with that kind picked.
  await quick.getByRole('button', { name: /^Call Family: no number saved/ }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('radio', { name: 'Family or other' })).toHaveAttribute('aria-checked', 'true');
  await context.close();
});

test('the Medicine page marks a dose with Take, and the reminders switch saves', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('button', { name: 'Take Synthetic Vitamin D, 9:00 AM dose' }).click();
  const row = page.locator('.drow', { hasText: 'Synthetic Vitamin D' });
  await expect(row.locator('.drow__done')).toHaveText('Taken');
  // A later dose cannot be marked yet; its outline button says when it can.
  const later = page.locator('.drow', { hasText: 'Synthetic Metformin' }).filter({ hasText: '8:00 PM' });
  await later.getByRole('button', { name: /not due yet/ }).click();
  await expect(later.getByRole('status')).toContainText('Available at 7:30 PM');
  const sw = page.getByRole('switch', { name: 'Reminders' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => mock.calls.some((c) => c.path === '/rest/v1/myday_notification_prefs' && JSON.stringify(c.body).includes('"dose_due":false'))).toBe(true);
  await context.close();
});

test('Updates: a feeling tile starts a note and the general chat saves nothing', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/updates' });
  await page.getByRole('group', { name: 'How are you feeling now?' }).getByRole('button', { name: 'Headache' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a health note' }).getByRole('textbox').first()).toHaveValue('Headache');
  await page.keyboard.press('Escape');
  await page.route('**/functions/v1/ai-assist', (r) => r.fulfill({ json: { result: { reply: 'Hello! How are you feeling?', suggestions: [], urgent: false } } }));
  await page.getByRole('button', { name: /^Chat with MyDay Talk about/ }).click();
  await expect(page.locator('.nchat__msg--ai')).toContainText('Hello!');
  await expect(page.getByRole('button', { name: 'Save this to my note' })).toHaveCount(0);
  expect(mock.db.myday_diary).toHaveLength(0);
  await context.close();
});
