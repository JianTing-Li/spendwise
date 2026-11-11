import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/db/store";
import { runPending } from "../src/server/investigation/run";
import { stubInvestigator } from "../src/server/investigation/stub";
const databases: PGlite[] = [];
const folders: string[] = [];
async function create(path?: string) {
  const db = new PGlite(path);
  databases.push(db);
  const store = new Store(db);
  await store.initialize();
  return store;
}
afterEach(async () => {
  for (const db of databases.splice(0)) if (!db.closed) await db.close();
  for (const dir of folders.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe("INV-09/10 local persistence", () => {
  it("survives three cycles, concurrent duplicate injections, and review retries", async () => {
    const store = await create();
    for (let i = 0; i < 3; i++) {
      const results = await Promise.all([store.inject(), store.inject()]);
      expect(results.map((r) => r.changed).sort()).toEqual([false, true]);
      await Promise.all([runPending(store), runPending(store)]);
      const state = await store.state();
      expect(state.dataset.payments).toHaveLength(27);
      expect(state.runs).toHaveLength(6);
      expect(
        state.runs.every(
          (r) =>
            r.state === "completed" &&
            r.mode === "stub" &&
            r.findings.every(
              (f) =>
                f.referenceStatus === "valid" &&
                f.supportStatus === "unverified",
            ),
        ),
      ).toBe(true);
      expect((await store.review(state.runs[0].id)).changed).toBe(true);
      expect((await store.review(state.runs[0].id)).changed).toBe(false);
      await store.reset();
      expect((await store.state()).dataset.payments).toHaveLength(20);
      expect((await store.state()).runs).toEqual([]);
    }
  });
  it("rejects a stale in-flight result after reset and reinjection", async () => {
    const store = await create();
    await store.inject();
    const run = (await store.state()).runs[0];
    const input = await store.claim(run.id);
    expect(input).not.toBeNull();
    await store.reset();
    await store.inject();
    const result = await stubInvestigator.investigate(
      input!,
      new AbortController().signal,
    );
    expect(await store.finish(run.id, run.generation, result)).toBe(false);
    expect(
      (await store.state()).runs.every(
        (r) => r.generation === 1 && r.state === "pending",
      ),
    ).toBe(true);
  });
  it("recovers expired pending runs without pretending they completed", async () => {
    const store = await create();
    await store.inject(Date.now() - 61000);
    const state = await store.state();
    expect(
      state.runs.every(
        (r) => r.state === "incomplete" && r.error === "deadline",
      ),
    ).toBe(true);
    await expect(store.review(state.runs[0].id)).rejects.toThrow();
  });
  it("preserves injection and review across database close/reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spendwise-test-"));
    folders.push(dir);
    const first = await create(dir);
    await first.inject();
    await runPending(first);
    const id = (await first.state()).runs[0].id;
    await first.review(id);
    await first.db.close();
    const second = await create(dir);
    const state = await second.state();
    expect(state.injected).toBe(true);
    expect(state.runs.find((r) => r.id === id)?.reviewedAt).not.toBeNull();
  });
});
