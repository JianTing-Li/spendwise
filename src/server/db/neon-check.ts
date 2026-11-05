/** Separately authorized compatibility check. Never part of routine tests. */
import { randomUUID } from "node:crypto";
import { databaseConfig } from "./config";
import { PgDatabase } from "./pg";
import { Store } from "./store";
import type { Database } from "./database";
import { assertReadOnly, assertApplication, assertApplicationGrants } from "./permissions";
import { verifyIsolatedCompatibility } from "./compatibility";
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
  try {
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
        await tx.query("SELECT set_config('search_path',$1,true)", [schema + ",pg_catalog"]);
        return work(tx);
      }) };
    await verifyIsolatedCompatibility(isolated);
    console.log("Neon runtime-login preflight and isolated migration replay/three-cycle fixture check passed; zero model calls.");
  }
  finally {
    try {
      if (created)
        await migration.transaction(tx => tx.exec(`DROP SCHEMA "${schema}" CASCADE`));
    }
    finally {
      const closed = await Promise.allSettled([reader.close(), application.close(), migration.close()]);
      if (closed.some(result => result.status === "rejected"))
        throw new Error("Database pool cleanup failed");
    }
  }
}
main().catch(() => { console.error("Neon compatibility check failed; no credential details logged."); process.exitCode = 1; });
