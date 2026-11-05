import type { Database } from "./database";
import { migrations } from "./migrations/bundled";
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    // PostgreSQL serializes even first-time schema creation across processes.
    if (db.dialect === "postgres")
      await tx.query("SELECT pg_advisory_xact_lock(41601, 4)");
    await tx.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)");
    await tx.exec("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    const applied = (await tx.query<{
      version: number;
    }>("SELECT version FROM schema_migrations ORDER BY version")).rows.map(r => r.version);
    if (applied.some((v, i) => v !== i + 1) || applied.length > migrations.length)
      throw new Error("Unsupported migration version");
    for (let i = applied.length; i < migrations.length; i++) {
      await tx.exec(migrations[i]);
      await tx.query("INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING", [i + 1]);
    }
  });
}
