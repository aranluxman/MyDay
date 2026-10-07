// P1: modal focus containment, Escape, inert background, focus restoration.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';
import { openNewMedicine, nameAndAmount } from './helpers.js';

const activeInTopDialog = (page) => page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')];
  const top = dialogs[dialogs.length - 1];
  return { inside: !!top && top.contains(document.activeElement), tag: document.activeElement?.tagName };
});

test('Tab and Shift+Tab never leave the wizard; the page behind is inert', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await openNewMedicine(page);
  await nameAndAmount(page, 'Focus test', '1', 'tablet');
  expect(await page.evaluate(() => document.getElementById('root').inert)).toBe(true);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
    const s = await activeInTopDialog(page);
    expect(s.inside, `focus escaped to ${s.tag} after ${i + 1} presses`).toBe(true);
  }
  await context.close();
});

test('Escape closes only the time picker, then the wizard, and focus returns', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await openNewMedicine(page);
  await nameAndAmount(page, 'Escape test', '1', 'tablet');
  const addTime = page.getByRole('button', { name: 'Add another time' });
  await addTime.click();
  await expect(page.getByRole('dialog', { name: 'Choose a time' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Choose a time' })).toHaveCount(0);
  await expect(page.locator('.wiz__title')).toHaveText('When do you take it?');
  await expect(addTime).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet--wizard')).toHaveCount(0);
  // Back in the batch sheet, on the control that opened the wizard.
  const s = await activeInTopDialog(page);
  expect(s.inside).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('root').inert)).toBe(false);
  await expect(page.getByRole('button', { name: 'Add medicines' }).first()).toBeFocused();
  await context.close();
});

test('any minute can be entered, AM/PM is explicit, and duplicates are refused', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await openNewMedicine(page);
  await nameAndAmount(page, 'Time test', '1', 'tablet');
  await page.getByRole('button', { name: 'Add another time' }).click();
  await page.getByLabel('Type a time').fill('19:07');
  await expect(page.locator('.tp__display')).toHaveText('7:07 PM');
  await expect(page.getByRole('button', { name: 'PM (afternoon/evening)' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Use 7:07 PM' }).click();
  await expect(page.getByRole('button', { name: 'Remove 7:07 PM' })).toBeVisible();
  await page.getByRole('button', { name: 'Add another time' }).click();
  await page.getByLabel('Type a time').fill('19:07');
  await page.getByRole('button', { name: 'Use 7:07 PM' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a time' }).getByRole('alert')).toContainText('already on your list');
  await context.close();
});

test('closing an edited medicine with changes asks before discarding', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await page.getByRole('tab', { name: 'Medicines' }).click();
  await page.locator('.medlist__summary', { hasText: 'Synthetic Vitamin D' }).click();
  await page.getByRole('button', { name: 'Edit Synthetic Vitamin D' }).click();
  await page.locator('#wiz-name').fill('Synthetic Vitamin D3');
  await page.keyboard.press('Escape');
  const alert = page.getByRole('alertdialog', { name: /Discard changes to Synthetic Vitamin D/ });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#wiz-name')).toHaveValue('Synthetic Vitamin D3');
  await context.close();
});
