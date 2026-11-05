import { afterEach, expect, it, vi } from 'vitest';
const { retry, state } = vi.hoisted(() => ({ retry: vi.fn(), state: vi.fn() }));
vi.mock('../src/server/db/local', () => ({ getStore: async () => ({ retry, state }) }));
vi.mock('../src/server/investigation/run', () => ({ runPending: vi.fn() }));
import { POST } from '../src/app/api/demo/retry/route';
const request = (body: object, origin = 'http://localhost:3100') => new Request('http://localhost:3100/api/demo/retry', { method: 'POST', headers: { host: 'localhost:3100', origin, 'content-type': 'application/json', 'x-spendwise-demo': '1' }, body: JSON.stringify(body) });
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it('denies hosted, Neon and foreign-origin retries before storage', async () => {
  vi.stubEnv('VERCEL', '1');
  expect((await POST(request({ predecessorId: 'r' }))).status).toBe(403);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('DATABASE_MODE', 'neon');
  expect((await POST(request({ predecessorId: 'r' }))).status).toBe(403);
  vi.stubEnv('DATABASE_MODE', 'postgres');
  expect((await POST(request({ predecessorId: 'r' }, 'https://foreign.test'))).status).toBe(403);
  expect(retry).not.toHaveBeenCalled();
});
it('validates predecessor-only request; preserves explicit errors and idempotency', async () => {
  expect((await POST(request({ predecessorId: 'r', generation: 3 }))).status).toBe(400);
  retry.mockResolvedValue({ generation: 2, changed: false });
  expect(await (await POST(request({ predecessorId: 'r' }))).json()).toEqual({ ok: true, generation: 2, changed: false });
  retry.mockRejectedValue(new Error('invalid_retry'));
  expect((await POST(request({ predecessorId: 'r' }))).status).toBe(409);
  retry.mockRejectedValue(new Error('driver contains credentials'));
  const response = await POST(request({ predecessorId: 'r' }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'unavailable' });
});
