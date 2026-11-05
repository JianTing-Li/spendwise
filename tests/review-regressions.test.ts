import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { verifyIsolatedCompatibility } from '../scripts/db-verification/compatibility';
it('rejects a nonempty schema before writing any application objects', async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE keep_me(value text); INSERT INTO keep_me VALUES ('preserve')");
    await expect(verifyIsolatedCompatibility(db)).rejects.toThrow('Empty disposable schema required');
    expect((await db.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")).rows).toEqual([{ tablename: 'keep_me' }]);
    expect((await db.query('SELECT * FROM keep_me')).rows).toEqual([{ value: 'preserve' }]);
  } finally { await db.close(); }
});

it('preserves the primary verification error and reports cleanup failure separately', async () => {
  const { withCleanup } = await import('../scripts/db-verification/cleanup');
  const primary = new Error('check failed');
  const cleanup = new Error('cleanup failed');
  let reports = 0;
  await expect(withCleanup(async () => { throw primary; }, async () => { throw cleanup; }, () => { reports++; })).rejects.toBe(primary);
  expect(reports).toBe(1);
  await expect(withCleanup(async () => 7, async () => { throw cleanup; }, () => { reports++; })).rejects.toBe(cleanup);
  expect(reports).toBe(2);
});
