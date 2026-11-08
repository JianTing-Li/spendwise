import { PGlite } from "@electric-sql/pglite";
import { Store } from "../src/server/db/store";
import { databaseRetrieval } from "../src/server/retrieval/database";

// Disposable local synthetic database only; never accepts credentials or a path.
export async function retrievalDemoDatabase() {
  const db = new PGlite();
  const store = new Store(db);
  await store.initialize();
  await store.inject();
  await db.exec(`CREATE ROLE spendwise_retrieval_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO spendwise_retrieval_reader;
    GRANT SELECT ON vendors,payments,invoices,vendor_notes,note_payments,note_invoices TO spendwise_retrieval_reader;`);
  const state = await store.state();
  return { db, store, state, retrieval: (exceptionId: string, generation = state.generation) =>
    databaseRetrieval({ application: db }, { exceptionId, generation }) };
}
