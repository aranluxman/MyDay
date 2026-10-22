// Accessibility semantics from the audit, plus an axe-core scan.
import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { openApp } from './harness.js';
import { openNewMedicine, nameAndAmount, cont, openFold } from './helpers.js';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');

test('Medicine: History and Manage medicines open from Today and come back', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('.daystrip [aria-current="date"]')).toContainText('Today, Wednesday, October 7');
  await page.getByRole('button', { name: 'Open your calendar and history' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Manage medicines' }).click();
  await expect(page.getByRole('heading', { name: 'Manage medicines' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add medicines' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
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
  await p2.page.getByRole('button', { name: /My contacts/ }).evaluate((b) => b.getAttribute('aria-expanded') === 'false' && b.click());
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
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page).toHaveTitle('Profile · MyDay');
  await expect(page.getByRole('switch', { name: 'All notifications' })).toBeInViewport();
  await context.close();
});

test('settings fold to one line each and open on tap, with the guide at the bottom', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/profile' });
  // Sections start folded with summaries; there is no "Show all" button.
  const appearance = page.getByRole('button', { name: /^Appearance/ });
  await expect(appearance).toHaveAttribute('aria-expanded', 'false');
  await expect(appearance).toContainText('Light theme');
  await expect(page.getByRole('button', { name: 'Show all' })).toHaveCount(0);
  await appearance.click();
  await expect(appearance).toHaveAttribute('aria-expanded', 'true');
  await appearance.click();
  await expect(appearance).toHaveAttribute('aria-expanded', 'false');
  // One section opens on tap, and stays open after a reload.
  await page.getByRole('button', { name: /^Accessibility/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Text size' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Accessibility/ })).toHaveAttribute('aria-expanded', 'true');
  // "How to use MyDay" is the last section, and its old page sends you here.
  const guide = page.getByRole('button', { name: /^How to use MyDay/ });
  await guide.click();
  await page.getByRole('button', { name: /Taking today/ }).click();
  await expect(page.getByText('Tap the blue “Take” button')).toBeVisible();
  await page.goto('/help');
  await expect(page).toHaveURL(/\/profile$/);
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
