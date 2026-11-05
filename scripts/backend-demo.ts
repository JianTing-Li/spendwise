import { PGlite } from "@electric-sql/pglite";
import { verifyIsolatedCompatibility } from "./db-verification/compatibility";
async function main() {
  const db = new PGlite();
  try { console.log(JSON.stringify(await verifyIsolatedCompatibility(db))); }
  finally { await db.close(); }
}
main().catch(() => { console.error("Local backend demo failed"); process.exitCode = 1; });
