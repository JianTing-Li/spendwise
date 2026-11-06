import { expect, it } from "vitest";
import { databaseConfig } from "../src/server/db/config";
const env = { DATABASE_MODE: 'neon', DATABASE_MIGRATION_ROLE: 'migration', DATABASE_URL: 'postgres://app@ep-demo-pooler.us-east-1.aws.neon.tech/demo', DATABASE_MIGRATION_URL: 'postgres://migration@ep-demo.us-east-1.aws.neon.tech/demo', DATABASE_READONLY_URL: 'postgres://reader@ep-demo-pooler.us-east-1.aws.neon.tech/demo' };
it('requires explicit valid modes and separate logins', () => {
  expect(databaseConfig({}).mode).toBe('local');
  expect(() => databaseConfig({ DATABASE_MODE: 'typo' })).toThrow();
  expect(() => databaseConfig({ VERCEL: '1' })).toThrow();
  expect(() => databaseConfig({ ...env, DATABASE_READONLY_URL: env.DATABASE_URL })).toThrow();
  expect(() => databaseConfig({ ...env, DATABASE_MODE: 'postgres' })).toThrow();
});
it('pins verified Neon TLS, pooled endpoint, and matching target', () => {
  const c = databaseConfig(env);
  if (c.mode === 'local')
    throw 0;
  expect(c.application.ssl).toEqual({ rejectUnauthorized: true });
  for (const query of ['sslmode=no-verify', 'sslmode=require', 'ssl=false', 'options=-c%20statement_timeout=0', 'host=evil.test'])
    expect(() => databaseConfig({ ...env, DATABASE_URL: env.DATABASE_URL + '?' + query })).toThrow();
  expect(() => databaseConfig({ ...env, DATABASE_URL: env.DATABASE_URL.replace('-pooler', '') })).toThrow();
  expect(() => databaseConfig({ ...env, DATABASE_READONLY_URL: env.DATABASE_READONLY_URL.replace('ep-demo', 'ep-other') })).toThrow();
});
it('does not need migration credentials in the application runtime', () => {
  const { DATABASE_MIGRATION_URL, ...runtime } = env;
  void DATABASE_MIGRATION_URL;
  const c = databaseConfig(runtime);
  expect(c.mode).toBe('neon');
  expect(() => databaseConfig(runtime, 'migration')).toThrow();
});
