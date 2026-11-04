import { Store } from "../../src/server/db/store";
import { scopedDatabase, verifyTarget } from "./pg-local";
import type { InvestigationResult } from "../../src/contracts";

const { db, pool } = scopedDatabase(process.argv[2]);
const store = new Store(db);
async function main() {
  await verifyTarget(pool);
  const pid = await db.transaction(async tx => (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  process.on("message", async (message: { action: string; id?: string; generation?: number; result?: InvestigationResult }) => {
    try {
      let value: unknown;
      switch (message.action) {
        case "inject": value = await store.inject(); break;
        case "claim": value = await store.claim(message.id!); break;
        case "reset": value = await store.reset(); break;
        case "finish": value = await store.finish(message.id!, message.generation!, message.result!); break;
        case "review": value = await store.review(message.id!); break;
        case "state": value = await store.state(); break;
        case "close": await db.close(); process.disconnect(); return;
        default: throw new Error("Unknown test action");
      }
      process.send?.({ value });
    } catch {
      process.send?.({ error: "worker operation failed" });
    }
  });
  process.send?.({ ready: true, pid, processId: process.pid });
}
main().catch(async () => {
  process.send?.({ error: "worker startup failed" });
  await db.close();
  process.exitCode = 1;
  process.disconnect();
});
