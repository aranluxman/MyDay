// P0: the amount entered is the amount saved, shown and reopened — exactly.
import { test, expect } from '@playwright/test';
import { openApp } from './harness.js';
import { openNewMedicine, nameAndAmount, cont, stepTitle, lastWrite } from './helpers.js';

for (const [typed, unit, shown] of [['2.75', 'mg', '2.75 mg'], ['0.1', 'mL', '0.1 mL'], ['0.125', 'mg', '0.125 mg']]) {
  test(`${typed} ${unit} is preserved through review, save and reopen`, async ({ browser }) => {
    const { page, mock, context } = await openApp(browser, { path: '/medication' });
    await openNewMedicine(page);
    await nameAndAmount(page, `Exact ${typed}`, typed, unit);
    await page.getByRole('button', { name: 'Skip to the summary' }).click();
    await expect(stepTitle(page)).toHaveText('Does this look right?');
    await expect(page.locator('.wiz__summary')).toContainText(shown);
    await page.getByRole('button', { name: 'Add to review' }).click();
    await expect(page.locator('.medbatch__item')).toContainText(shown);
    await page.getByRole('button', { name: /^Save all/ }).click();

    // Wait for the save to reach the (mock) server before inspecting it.
    await expect(page.locator('.toast').first()).toContainText('1 medicine added');
    const write = await lastWrite(mock, 'myday_medications');
    const row = write.body[0];
    expect(row.dose_amount).toBe(Number(typed));
    expect(row.dose).toBe(shown);

    // Reopen the saved record: the edit form shows the same exact amount.
    await page.locator('.medlist__summary', { hasText: `Exact ${typed}` }).click();
    await page.getByRole('button', { name: `Edit Exact ${typed}` }).click();
    await expect(page.locator('#wiz-name')).toHaveValue(`Exact ${typed}`);
    await cont(page);
    await expect(page.locator('#wiz-amount')).toHaveValue(typed);
    await context.close();
  });
}

test('invalid amounts are refused with one linked message, never substituted', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await openNewMedicine(page);
  await page.locator('#wiz-name').fill('Bad amounts');
  await cont(page);
  await page.getByRole('button', { name: 'mL', exact: true }).click();
  for (const [bad, msg] of [['-1', /more than zero/], ['0', /more than zero/], ['', /Enter how much/], ['abc', /Enter a number/], ['1e3', /Enter a number/], ['10000', /9999/]]) {
    await page.locator('#wiz-amount').fill(bad);
    await cont(page);
    await expect(stepTitle(page)).toHaveText('How much do you take?');
    const input = page.locator('#wiz-amount');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#wiz-amount-err')).toHaveText(msg);
    expect(await input.getAttribute('aria-describedby')).toContain('wiz-amount-err');
    // One message, and no duplicate alert regions.
    await expect(page.locator('.wiz__err')).toHaveCount(1);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await expect(page.locator('.wiz__preview')).not.toContainText('1/2');
  }
  await context.close();
});

test('"Skip to the summary" cannot bypass missing weekdays or times', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await openNewMedicine(page);
  await nameAndAmount(page, 'Shortcut test', '1', 'tablet');
  // Remove the only time.
  await page.getByRole('button', { name: /Morning/ }).click();
  await page.getByRole('button', { name: 'Skip to the summary' }).click();
  await expect(stepTitle(page)).toHaveText('When do you take it?');
  await expect(page.locator('#wiz-times-err')).toBeFocused();
  await expect(page.locator('#wiz-times-err')).toContainText('Pick at least one time');
  await page.getByRole('button', { name: /Evening/ }).click();
  await cont(page);
  await page.getByRole('radio', { name: /Certain days/ }).click();
  await page.getByRole('button', { name: 'Skip to the summary' }).click();
  await expect(stepTitle(page)).toHaveText('How often?');
  await expect(page.locator('#wiz-days-err')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Add to review' })).toHaveCount(0);
  // As-needed is the valid exception: no time, no day needed.
  await page.getByRole('radio', { name: /Only when needed/ }).click();
  await page.getByRole('button', { name: 'Skip to the summary' }).click();
  await expect(stepTitle(page)).toHaveText('Does this look right?');
  await context.close();
});

test('a stop date before the start date is refused, and dates appear in the review', async ({ browser }) => {
  const { page, context } = await openApp(browser, { path: '/medication' });
  await openNewMedicine(page);
  await nameAndAmount(page, 'Dated', '1', 'tablet');
  await cont(page);
  await page.getByRole('button', { name: /Start and stop dates/ }).click();
  await page.locator('#wiz-start').fill('2026-10-10');
  await page.locator('#wiz-end').fill('2026-10-09');
  await cont(page);
  await expect(stepTitle(page)).toHaveText('How often?');
  await expect(page.locator('#wiz-end')).toBeFocused();
  await expect(page.locator('#wiz-end_date-err')).toContainText('before the start date');
  // The duration shortcut: 10 days from Oct 10 stops after Oct 19.
  await page.getByRole('button', { name: 'for 10 days' }).click();
  await expect(page.locator('#wiz-end')).toHaveValue('2026-10-19');
  await page.getByRole('button', { name: 'Skip to the summary' }).click();
  const review = page.locator('.wiz__check');
  await expect(review).toContainText('Starts');
  await expect(review).toContainText('October 10');
  await expect(review).toContainText('After Monday, October 19');
  await expect(review).toContainText('10 days');
  await context.close();
});
