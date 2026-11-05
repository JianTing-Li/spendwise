/** Separately authorized compatibility check. Never part of routine tests. */
import { randomUUID } from "node:crypto";
import { databaseConfig } from "./config";
import { PgDatabase } from "./pg";
import { Store } from "./store";
import type { Database } from "./database";
import { assertReadOnly } from "./permissions";
import { injectedDataset } from "../../fixtures/scenarios";
import { summarize } from "../../domain/finance";
async function main() {
  if (process.env.NEON_CHECK_ALLOW_REMOTE !== "1")
    throw new Error("Separate Neon authorization required");
  const config = databaseConfig(process.env, "migration");
  if (config.mode !== "neon" || !config.migration)
    throw new Error("Neon configuration required");
  const migration = PgDatabase.create(config.migration);
  const reader = PgDatabase.create(config.readonly);
  const schema = "app01_check_" + randomUUID().replaceAll('-', '');
  let created = false;
  try {
    await reader.transaction(assertReadOnly);
    await migration.transaction(tx => tx.exec(`CREATE SCHEMA "${schema}"`));
    created = true;
    const isolated: Database = { dialect: "postgres", close: async () => { }, transaction: work => migration.transaction(async (tx) => {
        await tx.query("SELECT set_config('search_path',$1,true)", [schema + ",pg_catalog"]);
        return work(tx);
      }) };
    const store = new Store(isolated);
    await store.initialize();
    await store.inject();
    const state = await store.state();
    if (JSON.stringify([...state.summaries].sort((a,b)=>a.vendorId.localeCompare(b.vendorId))) !== JSON.stringify(summarize(injectedDataset()).sort((a,b)=>a.vendorId.localeCompare(b.vendorId))))
      throw new Error("Fixture totals mismatch");
    await store.initialize();
    await store.assertVersion();
    if ((await store.state()).runs.length !== 4 || (await store.inject()).changed)
      throw new Error("Migration/idempotency mismatch");
    console.log("Neon isolated migration replay and fixture totals passed; zero model calls.");
  }
  finally {
    try {
      if (created)
        await migration.transaction(tx => tx.exec(`DROP SCHEMA "${schema}" CASCADE`));
    }
    finally {
      await reader.close();
      await migration.close();
    }
  }
}
main().catch(() => { console.error("Neon compatibility check failed; no credential details logged."); process.exitCode = 1; });
