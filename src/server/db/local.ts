import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Store } from "./store";
const globalStore = globalThis as typeof globalThis & {
  spendwiseStore?: Promise<Store>;
};
export function getStore() {
  if (
    process.env.INVESTIGATOR_MODE &&
    !["stub", "real"].includes(process.env.INVESTIGATOR_MODE)
  )
    throw new Error("Investigator mode unavailable");
  if (
    process.env.VERCEL ||
    (process.env.DATABASE_MODE && process.env.DATABASE_MODE !== "local")
  )
    throw new Error("Database mode unavailable");
  if (!globalStore.spendwiseStore)
    globalStore.spendwiseStore = (async () => {
      const directory = resolve(process.env.PGLITE_DATA_DIR || ".data/spendwise");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const db = new PGlite(directory);
      const store = new Store(db);
      await store.initialize();
      return store;
    })().catch((error) => {
      globalStore.spendwiseStore = undefined;
      throw error;
    });
  return globalStore.spendwiseStore;
}
