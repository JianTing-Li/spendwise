/** Separately authorized compatibility check. Never part of routine tests. */
import { randomUUID } from "node:crypto";
import { databaseConfig } from "../../src/server/db/config";
import { PgDatabase } from "../../src/server/db/pg";
import { Store } from "../../src/server/db/store";
import type { Database } from "../../src/server/db/database";
import { assertReadOnly, assertApplication, assertApplicationGrants } from "../../src/server/db/permissions";
import { verifyIsolatedCompatibility } from "./compatibility";
import { withCleanup } from "./cleanup";
async function main() {
  if (process.env.NEON_CHECK_ALLOW_REMOTE !== "1")
    throw new Error("Separate Neon authorization required");
  const config = databaseConfig(process.env, "migration");
  if (config.mode !== "neon" || !config.migration)
    throw new Error("Neon configuration required");
  const migration = PgDatabase.create(config.migration);
  const reader = PgDatabase.create(config.readonly);
  const application = PgDatabase.create(config.application);
  const schema = "app01_check_" + randomUUID().replaceAll('-', '');
  let created = false;
  await withCleanup(async () => {
    // Check actual existing runtime logins without modifying application data.
    await reader.transaction(assertReadOnly);
    await application.transaction(async tx => {
      await assertApplication(tx);
      await assertApplicationGrants(tx);
    });
    await new Store(application).assertVersion();
    await migration.transaction(tx => tx.exec(`CREATE SCHEMA "${schema}"`));
    created = true;
    const isolated: Database = { dialect: "postgres", close: async () => { }, transaction: work => migration.transaction(async (tx) => {
        await tx.exec(`SET LOCAL search_path TO "${schema}",pg_catalog`);
        return work(tx);
      }) };
    await verifyIsolatedCompatibility(isolated);
    console.log("Neon runtime-login preflight and isolated migration replay/three-cycle fixture check passed; zero model calls.");
  }, async () => {
    await withCleanup(async () => {
      if (created)
        await migration.transaction(tx => tx.exec(`DROP SCHEMA "${schema}" CASCADE`));
    }, async () => {
      const closed = await Promise.allSettled([reader.close(), application.close(), migration.close()]);
      if (closed.some(result => result.status === "rejected"))
        throw new Error("Database pool cleanup failed");
    }, () => console.error("Neon pool cleanup failed; no credential details logged."));
  }, () => console.error("Neon cleanup failed; inspect the private test schema/pools. No credential details logged."));
}
main().catch(() => { console.error("Neon compatibility check failed; no credential details logged."); process.exitCode = 1; });
