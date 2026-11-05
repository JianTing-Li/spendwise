import { expect, it } from 'vitest';
import { assertReadOnly, assertApplicationGrants } from '../src/server/db/permissions';
import type { DatabaseTransaction } from '../src/server/db/database';
function fake(safe: boolean) {
  const statements: string[] = [];
  const tx: DatabaseTransaction = {
    query: async <T>(sql: string) => { statements.push(sql); return { rows: [{ safe }] as T[] }; },
    exec: async sql => { statements.push(sql); },
  };
  return { tx, statements };
}
it('fails closed before record queries when reader catalog preflight rejects', async () => {
  const { tx, statements } = fake(false);
  await expect(assertReadOnly(tx)).rejects.toThrow('Read-only database permissions required');
  expect(statements).toHaveLength(1);
  expect(statements[0]).toContain("'investigation_runs'");
  expect(statements[0]).toContain("'SELECT'");
});
it('requires record SELECT access after a safe reader preflight (control-flow test only)', async () => {
  const { tx, statements } = fake(true);
  await assertReadOnly(tx);
  expect(statements).toHaveLength(2);
  expect(statements[1]).toContain('SELECT note_id FROM note_invoices LIMIT 0');
});
it('rejects missing application grants (mocked catalog result, not real role verification)', async () => {
  await expect(assertApplicationGrants(fake(false).tx)).rejects.toThrow('Application record grants required');
  await assertApplicationGrants(fake(true).tx);
});
