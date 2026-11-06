import { databaseConfig } from "./config";
import { PgDatabase } from "./pg";
import { Store } from "./store";
async function main() {
  const config = databaseConfig(process.env, "migration");
  if (config.mode === "local" || !config.migration)
    throw new Error("Local migration runs at startup");
  const db = PgDatabase.create(config.migration);
  try {
    await new Store(db).initialize();
    console.log("Migrations applied; synthetic data preserved/initialized.");
  }
  catch {
    console.error("Migration failed; inspect database configuration and permissions.");
    process.exitCode = 1;
  }
  finally {
    await db.close();
  }
}
main().catch(() => { console.error("Database operation failed"); process.exitCode = 1; });
