import { Pool } from "pg";
import { PgDatabase, pgPoolOptions } from "../../src/server/db/pg";
import type { Database } from "../../src/server/db/database";
import { localConnection } from "./pg-local-config";
export const localTestConnection = localConnection(process.env);
export function assertTestSchema(schema: string) {
  if (!/^app01_test_[a-f0-9]{32}$/.test(schema))
    throw new Error("Invalid test schema");
}
export async function verifyTarget(pool: Pool) {
  const result = await pool.query<{
    database: string;
    user: string;
    version: number;
  }>("SELECT current_database() AS database, current_user AS user, current_setting('server_version_num')::int AS version");
  const row = result.rows[0];
  if (row.database !== localTestConnection.database || row.user !== localTestConnection.user || row.version < 170000 || row.version >= 180000)
    throw new Error("Unexpected local PostgreSQL test target");
}
export function scopedDatabase(schema: string) {
  assertTestSchema(schema);
  const pool = new Pool(pgPoolOptions({ ...localTestConnection, application_name: schema }));
  const adapter = new PgDatabase(pool);
  // Test-only schema isolation on the same pinned transaction; no production wiring.
  const db: Database = {
    dialect: "postgres",
    transaction: work => adapter.transaction(async (tx) => {
      await tx.exec(`SET LOCAL search_path TO "${schema}",pg_catalog`);
      return work(tx);
    }),
    close: () => adapter.close(),
  };
  return { db, pool, adapter };
}
