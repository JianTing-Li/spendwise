import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { Store } from "../src/server/db/store";
describe("database JSONB money boundary", () => {
  it.each(["9007199254740992", "1.5"])("rejects unsafe or fractional decoded cents: %s", async (cents) => {
    const db = new PGlite();
    try {
      const store = new Store(db);
      await store.initialize();
      // Model database corruption, bypassing the normal validated write path.
      await expect(db.query("UPDATE payments SET payload = jsonb_set(payload, '{amountCents}', $1::jsonb)", [cents])).rejects.toThrow();
      // Rejected corruption leaves the original data usable.
      await expect(store.state()).resolves.toBeDefined();
    }
    finally {
      await db.close();
    }
  });
});
