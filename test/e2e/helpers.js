import { expect } from '@playwright/test';

export async function openNewMedicine(page) {
  await page.getByRole('tab', { name: 'Medicines' }).click();
  await page.getByRole('button', { name: 'Add medicines' }).first().click();
  await page.getByRole('button', { name: 'Type a medicine' }).click();
  await expect(page.getByRole('dialog', { name: /What is it called/ })).toBeVisible();
}

export const wizard = (page) => page.getByRole('dialog').filter({ has: page.locator('.wiz__title') });
export const stepTitle = (page) => page.locator('.wiz__title');

export async function cont(page) { await page.getByRole('button', { name: 'Continue', exact: true }).click(); }

/** Fills the name and amount steps and leaves the wizard on the times step. */
export async function nameAndAmount(page, name, amount, unit) {
  await page.locator('#wiz-name').fill(name);
  await cont(page);
  await page.getByRole('button', { name: unit, exact: true }).click();
  await page.locator('#wiz-amount').fill(amount);
  await cont(page);
}

export async function lastWrite(mock, table) {
  return [...mock.calls].reverse().find((c) => c.path === `/rest/v1/${table}` && ['POST', 'PATCH'].includes(c.method));
}
