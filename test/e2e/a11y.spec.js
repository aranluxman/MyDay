// Accessibility semantics from the audit, plus an axe-core scan.
import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { openApp } from './harness.js';
import { openNewMedicine, nameAndAmount, cont, openFold } from './helpers.js';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');

test('Medicine: History and Manage medicines open from the main page and come back', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await expect(page.getByRole('radio', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('heading', { name: 'Today · Wed, Oct 7' })).toBeVisible();
  await expect(page.locator('.cal__grid [aria-current="date"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Your history' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await page.getByRole('button', { name: 'Medicine', exact: true }).click();
  await page.getByRole('button', { name: 'Manage medicines' }).click();
  await expect(page.getByRole('heading', { name: 'Manage medicines' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add medicines' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Medicine', exact: true }).click();
  await expect(page.locator('.cal')).toBeVisible();
  await context.close();
});

test('Medicine: the calendar shows the day you tap underneath it, and remembers List', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await page.locator('.cal__grid').getByRole('button', { name: /^Tuesday, October 6/ }).click();
  await expect(page.getByRole('heading', { name: 'Yesterday · Tue, Oct 6' })).toBeVisible();
  await expect(page.locator('.dayhead__pill')).toContainText('taken');
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.getByRole('heading', { name: 'Today · Wed, Oct 7' })).toBeVisible();
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page.locator('.daystrip')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.ring-card')).toBeVisible();
  await context.close();
});

test('notification dropdowns and switches have programmatic names', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile/notifications' });
  for (const name of ['Remind me again', 'How many times', 'Snooze length']) {
    await page.getByRole('button', { name: 'Missed doses' }).first().evaluate((b) => b.getAttribute('aria-expanded') === 'false' && b.click());
    await expect(page.getByRole('combobox', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: /Appointments and summaries/ }).evaluate((b) => b.getAttribute('aria-expanded') === 'false' && b.click());
  await expect(page.getByRole('combobox', { name: 'Remind me before a visit' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Daily summary time' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'All notifications' })).toBeVisible();
  await context.close();
});

test('two devices are distinguishable, with device-specific remove labels', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile/notifications' });
  await page.getByRole('button', { name: /Devices getting your alerts/ }).evaluate((b) => b.getAttribute('aria-expanded') === 'false' && b.click());
  const removes = page.getByRole('button', { name: /^Remove / });
  await expect(removes).toHaveCount(2);
  const names = await removes.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(new Set(names).size).toBe(2);
  expect(names[0]).toMatch(/iPhone.*added Sep 2.*installed app/);
  expect(names[1]).toMatch(/Android device.*added Sep 20.*browser/);
  await removes.nth(0).click();
  await expect(page.getByRole('alertdialog')).toContainText('iPhone');
  await page.keyboard.press('Escape');
  await context.close();
});

test('readiness separates preference, medicines, permission, subscription and delivery', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile/notifications' });
  await openFold(page, /^Will reminders reach me/);
  const list = page.locator('.ready-list');
  for (const t of ['Reminders are on in MyDay', 'Medicines with reminders', 'This device allows notifications', 'This device is signed up for alerts', 'Last alert sent to this device']) {
    await expect(list).toContainText(t);
  }
  await expect(page.locator('main')).toContainText('Only a test you actually see on your screen proves it arrived');
  await context.close();
});

test('colour swatches have names and selected state; contact type is a radio group', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await openNewMedicine(page);
  await nameAndAmount(page, 'Colours', '1', 'tablet');
  await cont(page); await cont(page);
  const blue = page.getByRole('radio', { name: 'Blue' });
  await expect(blue).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Purple' }).click();
  await expect(page.getByRole('radio', { name: 'Purple' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[aria-label^="Colour #"]')).toHaveCount(0);
  await context.close();

  const p2 = await openApp(browser, { path: '/profile' });
  await p2.page.getByRole('button', { name: /^My contacts/ }).click();
  await p2.page.getByRole('button', { name: 'Add a contact' }).click();
  const pharmacy = p2.page.getByRole('radio', { name: 'Pharmacy' });
  await expect(pharmacy).toHaveAttribute('aria-checked', 'true');
  await expect(p2.page.getByRole('radiogroup', { name: 'Type' })).toBeVisible();
  // Phone validation on the emergency contact.
  await p2.page.locator('#contact-name').fill('Synthetic Neighbour');
  await p2.page.locator('#contact-phone').fill('12');
  await p2.page.getByRole('button', { name: 'Add contact' }).click();
  await expect(p2.page.locator('#contact-phone')).toBeFocused();
  await expect(p2.page.locator('#contact-phone-err')).toContainText('does not look right');
  await p2.context.close();
});

test('skip link and meaningful route titles', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await expect(page).toHaveTitle('Medicine · MyDay');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
  // Alerts are a section of Profile now; the old address opens it there.
  await page.goto('/profile/notifications');
  await expect(page).toHaveURL(/\/profile\?section=alerts$/);
  await expect(page).toHaveTitle('Profile · MyDay');
  await expect(page.getByRole('switch', { name: 'All notifications' })).toBeInViewport();
  await context.close();
});

test('settings is one list; each row opens its own page with a back button', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile' });
  // Every row says what is inside before it is opened.
  const appearance = page.getByRole('button', { name: /^Appearance/ });
  await expect(appearance).toContainText('Light theme');
  await expect(page.getByRole('button', { name: 'Show all' })).toHaveCount(0);
  // A row opens its page; the back button returns to the list.
  await page.getByRole('button', { name: /^Accessibility/ }).click();
  await expect(page).toHaveURL(/section=access/);
  await expect(page.getByRole('radiogroup', { name: 'Text size' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Display contrast' })).toBeVisible();
  // The page survives a reload, and the phone's back goes to the list.
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Text size' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Settings' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  // "How to use MyDay" is the last row, and its old page sends you to Settings.
  await page.getByRole('button', { name: /^How to use MyDay/ }).click();
  await page.getByRole('button', { name: /Taking today/ }).click();
  await expect(page.getByText('Tap the blue “Take” button')).toBeVisible();
  await page.goto('/help');
  await expect(page).toHaveURL(/\/profile/);
  await context.close();
});

test('"How your medicines work together" minimizes and stays minimized', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('button', { name: 'Manage medicines' }).click();
  await page.getByRole('button', { name: 'Minimize how your medicines work together' }).click();
  const mini = page.locator('.insights-mini');
  await expect(mini).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explain my medicines' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Manage medicines' }).click();
  await expect(mini).toBeVisible();
  await mini.click();
  await expect(page.getByRole('button', { name: 'Explain my medicines' })).toBeVisible();
  await context.close();
});

// axe-core across the main phone screens and every theme. Reported per rule;
// colour contrast is the audit's open question, so it is printed in full.
const THEMES = ['light', 'dark', 'contrast', 'warm', 'fresh', 'ocean', 'rose', 'midnight'];
for (const theme of THEMES) {
  test(`axe: ${theme} theme`, async ({ browser }, info) => {
    const results = [];
    for (const path of ['/', '/medication', '/profile/notifications', '/profile']) {
      const { page, context } = await openApp(browser, { path, theme, width: 390, height: 844 });
      await page.waitForSelector('main .stack');
      await page.waitForTimeout(500);
      await page.addScriptTag({ path: AXE });
      const r = await page.evaluate(async () => {
        const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
        return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => `${x.target.join(' ')} :: ${(x.any[0]?.message || '').slice(0, 120)}`) }));
      });
      results.push(...r.map((v) => ({ path, ...v })));
      await context.close();
    }
    await info.attach(`axe-${theme}.json`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
    console.log(`AXE ${theme}: ${JSON.stringify(results)}`);
    expect.soft(results.filter((v) => v.impact === 'critical' || v.impact === 'serious'), JSON.stringify(results, null, 1)).toEqual([]);
  });
}

test('Appointments: Quick add fills the reason, a row opens its actions, and Past lists earlier visits', async ({ browser }) => {
  const { page, mock, context } = await openApp(browser, { path: '/appointments' });
  const u = mock.db.myday_profiles[0].user_id;
  mock.db.myday_appointments.push({ id: 'a-past', user_id: u, appt_date: '2026-09-28', appt_time: '11:00', doctor_name: null, location: 'Vision Centre', reason: 'Eye Exam' });
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Upcoming' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Dentist', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add an appointment' });
  await expect(form.getByLabel('Reason')).toHaveValue('Dentist check-up');
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await page.getByRole('list', { name: 'Upcoming appointments' }).getByRole('button', { name: /Dr\. Synthetic/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Dr. Synthetic' });
  for (const name of ['Directions', 'Add to calendar']) await expect(sheet.getByRole('link', { name }).or(sheet.getByRole('button', { name }))).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Edit' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'See all' }).click();
  await expect(page.getByRole('radio', { name: 'Past' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('list', { name: 'Past appointments' })).toContainText('Eye Exam');
  await context.close();
});
