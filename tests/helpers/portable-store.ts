import { PGlite } from "@electric-sql/pglite";
import { Store } from "../../src/server/db/store";
async function main() {
  const db = new PGlite();
  try {
    const store = new Store(db);
    await store.initialize();
    console.log(JSON.stringify({ versions: (await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows, payments: (await store.state()).dataset.payments.length }));
  }
  finally {
    await db.close();
  }
}
main().catch(() => { console.error("Database operation failed"); process.exitCode = 1; });
