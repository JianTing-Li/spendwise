import { PGlite } from "@electric-sql/pglite";
import { Store } from "../src/server/db/store";
import { databaseRetrieval } from "../src/server/retrieval/database";

// Disposable local synthetic database only; never accepts credentials or a path.
export async function retrievalDemoDatabase() {
  const db = new PGlite();
  const store = new Store(db);
  await store.initialize();
  await store.inject();
  const state = await store.state();
  return { db, store, state, retrieval: (exceptionId: string, generation = state.generation) =>
    databaseRetrieval({ application: db }, { exceptionId, generation }) };
}
