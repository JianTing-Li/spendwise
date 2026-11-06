import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { databaseConfig } from "./config";
import { PgDatabase } from "./pg";
import { assertReadOnly, assertApplication } from "./permissions";
import { Store } from "./store";
const globalStore = globalThis as typeof globalThis & {
  spendwiseStore?: Promise<Store>;
};
export function getStore() {
  if (process.env.INVESTIGATOR_MODE &&
    !["stub", "real"].includes(process.env.INVESTIGATOR_MODE))
    throw new Error("Investigator mode unavailable");
  const config = databaseConfig();
  if (!globalStore.spendwiseStore)
    globalStore.spendwiseStore = (async () => {
      if (config.mode !== "local") {
        const db = PgDatabase.create(config.application);
        const readonly = PgDatabase.create(config.readonly);
        try {
          await readonly.transaction(assertReadOnly);
          await db.transaction(assertApplication);
          const store = new Store(db);
          await store.assertVersion();
          return store;
        }
        catch (error) {
          await db.close();
          throw error;
        }
        finally {
          // Preflight-only pool: a close failure must not discard (and leak) the application pool.
          try {
            await readonly.close();
          }
          catch {
            // Ignored: the preflight already passed or its error is rethrown above.
          }
        }
      }
      const directory = resolve(process.env.PGLITE_DATA_DIR || ".data/spendwise");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const db = new PGlite(directory);
      const store = new Store(db);
      try {
        await store.initialize();
      }
      catch (error) {
        await db.close();
        throw error;
      }
      return store;
    })().catch((error) => {
      globalStore.spendwiseStore = undefined;
      throw error;
    });
  return globalStore.spendwiseStore;
}
