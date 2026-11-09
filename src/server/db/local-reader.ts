import type { Database } from "./database";
import { assertReadOnly } from "./permissions";

/** Local PGlite only. Not a migration or a hosted privilege provisioner. */
export async function initializeLocalReader(db: Database) {
  if (db.dialect === "postgres") throw new Error("Local reader requires PGlite");
  await db.transaction(async tx => {
    const existing = (await tx.query("SELECT 1 FROM pg_roles WHERE rolname='spendwise_retrieval_reader'")).rows.length;
    if (!existing) await tx.exec("CREATE ROLE spendwise_retrieval_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
    await tx.exec(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO spendwise_retrieval_reader;
      GRANT SELECT ON vendors,payments,invoices,vendor_notes,note_payments,note_invoices TO spendwise_retrieval_reader;
      SET LOCAL ROLE spendwise_retrieval_reader`);
    await assertReadOnly(tx);
  });
}
