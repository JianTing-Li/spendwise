import { test, expect } from '@playwright/test';
test('retry persists history, stops at three, rejects stale predecessor after reset', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByText('Baseline ready')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate new payments' }).click();
  await expect(page.getByRole('button', { name: 'Retry investigation (1/3 attempts used)' })).toHaveCount(4);
  const initial = await (await request.get('/api/demo')).json();
  const predecessorId = initial.runs[0].id;
  const card = page.locator('article.finding').first();
  await card.getByRole('button', { name: 'Retry investigation (1/3 attempts used)' }).click();
  await expect(card.getByRole('button', { name: 'Retry investigation (2/3 attempts used)' })).toBeVisible();
  await card.getByRole('button', { name: 'Retry investigation (2/3 attempts used)' }).click();
  await expect(card.getByText('Three attempts used. Reset the demo to start again.')).toBeVisible();
  await page.reload();
  await expect(card.getByText('Three attempts used. Reset the demo to start again.')).toBeVisible();
  await card.getByText('Attempt history').click();
  await expect(card.getByRole('heading', { name: 'Attempt 2', exact: true })).toBeVisible();
  const after = await (await request.get('/api/demo')).json();
  expect(after.runs.filter((r: {
    exceptionId: string;
  }) => r.exceptionId === initial.runs[0].exceptionId)).toHaveLength(3);
  expect(after.runs.every((r: {
    modelRequests: number;
  }) => r.modelRequests === 0)).toBe(true);
  await page.screenshot({ path: 'test-results/retry-history.png', fullPage: true });
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByText('Baseline ready')).toBeVisible();
  const stale = await request.post('/api/demo/retry', { headers: { Origin: 'http://127.0.0.1:3100', 'X-Spendwise-Demo': '1' }, data: { predecessorId } });
  expect(stale.status()).toBe(409);
});
