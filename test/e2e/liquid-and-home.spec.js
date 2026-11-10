// The Liquid Glass controls, the laptop side rail, the Call fix, the guide's
// "Show me" buttons, the customizable Home and medicine questions.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';

const LAPTOPS = [[1280, 720], [1366, 768]];

for (const [width, height] of LAPTOPS) {
  test(`every page is reachable from the side rail at ${width}x${height}`, async ({ browser }) => {
    const { page, context } = await openApp(browser, { width, height, mobile: false });
    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Home', 'Medicines', 'Appointments', 'Contacts', 'Health diary', 'Games', 'Settings']) {
      await expect(rail.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // My cards is gone, and Alerts is a section of Settings rather than a page.
    await expect(rail.getByRole('link', { name: 'My cards' })).toHaveCount(0);
    await expect(rail.getByRole('link', { name: 'Alerts' })).toHaveCount(0);
    // Help is not a page of its own: "How to use MyDay" lives in Settings.
    await expect(rail.getByRole('link', { name: 'Help' })).toHaveCount(0);
    await rail.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await page.getByRole('button', { name: /^Alerts & reminders/ }).click();
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

// The glass lens that slid along the tab bar was removed in the November 2026
// redesign: the bar is flat, and the page you are on is a pale pill.
test('the tab bar is flat: a tap opens a tab and marks it as the current page', async ({ browser }) => {
  const { page, context } = await openApp(browser);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(page.locator('.bottom-nav__ind')).toHaveCount(0);
  await nav.getByRole('link', { name: 'Diary', exact: true }).click();
  await expect(page).toHaveURL(/\/updates$/);
  await expect(nav.getByRole('link', { name: 'Diary', exact: true })).toHaveAttribute('aria-current', 'page');
  await context.close();
});

test('a switch can be slid, tapped or flipped from the keyboard', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile' });
  await page.getByRole('button', { name: /^Accessibility/ }).click();
  const sw = page.getByRole('switch', { name: 'Bold text' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.scrollIntoViewIfNeeded();
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
  await page.locator('.appt', { hasText: 'Blood test' }).click();
  const card = page.getByRole('dialog', { name: 'Blood test' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Call' })).toHaveCount(0);
  await expect(page.locator('a[href="tel:467"]')).toHaveCount(0);
  await context.close();
});

test('the guide’s "Open Guardians" opens and scrolls to Guardians', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile' });
  await page.getByRole('button', { name: /^How to use MyDay/ }).click();
  await page.getByRole('button', { name: /Letting family keep an eye out/ }).click();
  await page.getByRole('button', { name: 'Open Guardians' }).click();
  await expect(page).toHaveURL(/section=guardians/);
  await expect(page.getByRole('heading', { name: 'Guardians' })).toBeInViewport();
  await context.close();
});

test('Home can be rearranged, and a mood tap is saved with Undo', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser);
  await page.getByRole('button', { name: 'Edit Home' }).click();
  await page.getByRole('switch', { name: 'Contacts' }).click();
  await page.getByRole('switch', { name: 'Health diary' }).click();
  await page.getByRole('button', { name: 'Move Next appointment up' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('region', { name: 'Contacts' })).toHaveCount(0);
  await expect(page.locator('.home-w--diary')).toBeVisible();
  await page.reload();
  await page.waitForSelector('.today-side');
  await expect(page.getByRole('region', { name: 'Contacts' })).toHaveCount(0);
  await expect(page.locator('.home-w--diary')).toBeVisible();
  const order = await page.locator('.home-w').evaluateAll((els) => els.map((e) => e.className.match(/home-w--(\w+)/)[1]));
  expect(order.indexOf('nextVisit')).toBeLessThan(order.indexOf('week'));
  // Today's medicines is never a widget that can be hidden or moved.
  await expect(page.getByRole('heading', { name: 'Next medicine' })).toBeVisible();

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

test('contacts dial saved numbers, say plainly when one is missing, and 911 asks first', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser);
  const uid = mock.db.myday_profiles[0].user_id;
  mock.db.myday_contacts.push({ id: 'c-doc', user_id: uid, name: 'Dr. Synthetic', type: 'provider', phone: '(555) 123-4567' });
  await page.reload();
  const quick = page.getByRole('region', { name: 'Contacts' });
  await expect(quick.getByRole('link', { name: /^Call doctor\s*:\s*Dr\. Synthetic\s*,\s*\(555\) 123-4567/ })).toHaveAttribute('href', 'tel:5551234567');
  // Nothing dials 911 on a single tap.
  await expect(page.locator('a[href="tel:911"]')).toHaveCount(0);
  await quick.getByRole('button', { name: 'Emergency call' }).click();
  const sos = page.getByRole('dialog', { name: 'Call 911?' });
  await expect(sos.getByRole('link', { name: 'Call 911 now' })).toHaveAttribute('href', 'tel:911');
  await sos.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // No family number saved: it says "Add family contact", never looks like a call button.
  await expect(quick.getByRole('link', { name: /family/i })).toHaveCount(0);
  await quick.getByRole('button', { name: 'Add family contact' }).click();
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(page.getByRole('radio', { name: 'Family or other' })).toHaveAttribute('aria-checked', 'true');
  await context.close();
});

test('the Medicines page records a dose with Record as taken, and the reminders switch saves', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('button', { name: 'Record as taken: Synthetic Vitamin D, 9:00 AM dose' }).click();
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

test('a sheet follows a drag on its grabber: a short pull springs back, a long one closes', async ({ browser }) => {
  // Full motion here, so the springs actually run.
  const { page, context } = await openApp(browser, { mobile: false, settings: { calmMotion: false } });
  await page.getByRole('button', { name: 'My calendar' }).click();
  const sheet = page.getByRole('dialog', { name: 'Your calendar' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(400); // let it finish arriving
  const grab = await sheet.locator('.sheet__grab').boundingBox();
  const x = grab.x + grab.width / 2;
  const y = grab.y + grab.height / 2;
  const before = (await sheet.boundingBox()).y;

  // A short, slow pull: it follows the finger, then springs home.
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + i * 10);
  await expect(sheet).toHaveClass(/is-dragging/);
  expect((await sheet.boundingBox()).y).toBeGreaterThan(before + 40);
  await page.waitForTimeout(150); // a still finger: no momentum
  await page.mouse.up();
  await expect.poll(async () => Math.round((await sheet.boundingBox()).y)).toBe(Math.round(before));

  // Past halfway: it closes.
  const h = (await sheet.boundingBox()).height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + (i * h * 0.7) / 10);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.close();
});

test('dragging the edit wizard down still asks before discarding changes', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication', mobile: false, settings: { calmMotion: false } });
  await page.getByRole('button', { name: 'Manage medicines' }).click();
  await page.locator('.medlist__summary', { hasText: 'Synthetic Vitamin D' }).click();
  await page.getByRole('button', { name: 'Edit Synthetic Vitamin D' }).click();
  await page.locator('#wiz-name').fill('Synthetic Vitamin D3');
  const sheet = page.locator('.sheet--wizard');
  await page.waitForTimeout(400);
  const grab = await sheet.locator('.sheet__grab').boundingBox();
  const h = (await sheet.boundingBox()).height;
  await page.mouse.move(grab.x + grab.width / 2, grab.y + 4);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(grab.x + grab.width / 2, grab.y + 4 + (i * h * 0.7) / 10);
  await page.mouse.up();
  await expect(page.getByRole('alertdialog', { name: /Discard changes to Synthetic Vitamin D/ })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.locator('#wiz-name')).toHaveValue('Synthetic Vitamin D3');
  await context.close();
});

test('Medicine: tapping a day shows it right there, with scheduled and taken times', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('radio', { name: 'Today' }).click();
  const strip = page.getByRole('group', { name: 'Pick a day this week' });
  await expect(strip.getByRole('button', { name: /^Today, Wednesday, October 7/ })).toHaveAttribute('aria-pressed', 'true');

  // Yesterday: the record, in place — no trip to another page.
  await strip.getByRole('button', { name: 'Tuesday, October 6' }).click();
  await expect(page).toHaveURL(/\/medication$/);
  await expect(page.getByRole('heading', { name: 'Yesterday' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'History' })).toHaveCount(0);
  const taken = page.locator('.drow', { hasText: 'Synthetic Vitamin D' });
  await expect(taken).toContainText('Scheduled 9:00 AM');
  await expect(taken).toContainText('Taken 9:00 AM');
  await expect(taken.locator('.drow__flag--ontime')).toHaveText('On time');

  // Forgot to tap yesterday: mark it with the real time, and it reads as late.
  const missed = page.locator('.drow', { hasText: 'Synthetic Metformin' }).filter({ hasText: '8:00 PM' });
  await missed.getByRole('button', { name: 'Record as taken: Synthetic Metformin, 8:00 PM dose' }).click();
  await page.getByLabel('Type a time').fill('23:30');
  await page.getByRole('button', { name: 'Use 11:30 PM' }).click();
  await expect(page.locator('.toast').first()).toContainText('taken at 11:30');
  await expect(missed.locator('.drow__flag--late')).toHaveText('Late by 3h 30m');
  const row = mock.db.myday_doses.find((d) => d.medication_id === 'm-met' && d.dose_date === '2026-10-06' && d.scheduled_time === '20:00');
  expect(row.status).toBe('taken');

  // Older days are a read-only record.
  await strip.getByRole('button', { name: 'Monday, October 5' }).click();
  await expect(page.getByRole('heading', { name: 'Monday' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Record as taken/ })).toHaveCount(0);

  // A later day is the plan; "Back to today" returns to the live list.
  await strip.getByRole('button', { name: 'Friday, October 9' }).click();
  await expect(page.getByRole('heading', { name: 'Friday' })).toBeVisible();
  await expect(page.locator('.ring-card')).toContainText('doses planned');
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record as taken: Synthetic Vitamin D, 9:00 AM dose' })).toBeVisible();
  await context.close();
});
