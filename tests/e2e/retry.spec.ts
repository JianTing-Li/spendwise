import { test, expect } from '@playwright/test';
test('retry persists history, stops at three, rejects stale predecessor after reset', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(page.getByText('No flags yet')).toBeVisible();
  await page.getByRole('button', { name: 'Load October payments' }).click();
  const card = page.locator('article.flag').first();
  await expect(card.getByRole('button', { name: 'Try again (1 of 3 used)' })).toBeVisible();
  await expect(page.locator('.vendor-row .badge.failed')).toHaveCount(5);
  const initial = await (await request.get('/api/demo')).json();
  const firstException = [...initial.exceptions].sort(
    (a: { summary: { differenceCents: number } }, b: { summary: { differenceCents: number } }) =>
      b.summary.differenceCents - a.summary.differenceCents,
  )[0];
  const predecessorId = initial.runs.find(
    (r: { exceptionId: string }) => r.exceptionId === firstException.id,
  ).id;
  await card.getByRole('button', { name: 'Try again (1 of 3 used)' }).click();
  await expect(card.getByRole('button', { name: 'Try again (2 of 3 used)' })).toBeVisible();
  await card.getByRole('button', { name: 'Try again (2 of 3 used)' }).click();
  await expect(card.getByText(/All 3 attempts are used/)).toBeVisible();
  await page.reload();
  await expect(card.getByText(/All 3 attempts are used/)).toBeVisible();
  await card.getByText('Details').click();
  await expect(card.getByText(/Earlier attempts: #1 failed/)).toBeVisible();
  const after = await (await request.get('/api/demo')).json();
  expect(after.runs.filter((r: {
    exceptionId: string;
  }) => r.exceptionId === firstException.id)).toHaveLength(3);
  expect(after.runs.every((r: {
    modelRequests: number;
  }) => r.modelRequests === 0)).toBe(true);
  await page.screenshot({ path: 'test-results/retry-history.png', fullPage: true });
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByText('Reset this company?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(page.getByText('No flags yet')).toBeVisible();
  const stale = await request.post('/api/demo/retry', { headers: { Origin: 'http://127.0.0.1:3100', 'X-Spendwise-Demo': '1' }, data: { predecessorId } });
  expect(stale.status()).toBe(409);
});
