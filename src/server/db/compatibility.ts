import { isDeepStrictEqual } from "node:util";
import type { Database } from "./database";
import { Store } from "./store";
import { migrations } from "./migrations/bundled";
import type { Dataset } from "../../contracts";
import { baseline, injectedDataset } from "../../fixtures/scenarios";
import { summarize } from "../../domain/finance";
import { stubInvestigator } from "../investigation/stub";

function equal(actual: unknown, expected: unknown, message: string) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message);
}
function records(data: Dataset) {
  const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((a,b) => a.id.localeCompare(b.id));
  return { vendors: sorted(data.vendors), invoices: sorted(data.invoices), payments: sorted(data.payments), notes: sorted(data.notes) };
}
/** Destructive only within a caller-owned EMPTY disposable database/schema.
 * No environment-selected investigator, model client, grants or provisioning.
 * Shared by the local demo, offline regression and authorized Neon check.
 */
export async function verifyIsolatedCompatibility(db: Database) {
  // Populate immutable 001 first: this catches upgrade regressions in the
  // same procedure that will later run on Neon, not just fresh-schema replay.
  await db.transaction(async tx => {
    await tx.exec(migrations[0]);
    for (const v of baseline.vendors)
      await tx.query('INSERT INTO vendors VALUES ($1,$2)', [v.id, JSON.stringify(v)]);
    for (const [table, rows] of [['invoices', baseline.invoices], ['payments', baseline.payments], ['vendor_notes', baseline.notes]] as const)
      for (const row of rows)
        await tx.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, [row.id, row.vendorId, JSON.stringify(row)]);
  });
  const store = new Store(db);
  await store.initialize();
  equal(records((await store.state()).dataset), records(baseline), "Baseline mismatch");
  for (let cycle = 0; cycle < 3; cycle++) {
    const injected = await store.inject();
    equal(injected.changed, true, "Injection mismatch");
    equal((await store.inject()).changed, false, "Injection replay mismatch");
    const state = await store.state();
    equal(records(state.dataset), records(injectedDataset()), "Fixture records mismatch");
    equal([...state.summaries].sort((a,b) => a.vendorId.localeCompare(b.vendorId)),
      summarize(injectedDataset()).sort((a,b) => a.vendorId.localeCompare(b.vendorId)), "Fixture totals mismatch");
    equal(state.runs.length, 4, "Detection mismatch");
    for (const run of state.runs) {
      const input = await store.claim(run.id);
      if (!input) throw new Error("Claim mismatch");
      await store.finish(run.id, run.generation,
        await stubInvestigator.investigate(input, new AbortController().signal));
    }
    await store.review(state.runs[0].id);
    const completed = await store.state();
    if (completed.runs.some(r => r.modelRequests !== 0 || r.mode !== "stub" || r.state !== "completed"))
      throw new Error("Stub completion mismatch");
    await store.initialize();
    await store.assertVersion();
    equal(await store.state(), completed, "Migration replay changed records/results/review");
    await store.reset();
    const reset = await store.state();
    equal(records(reset.dataset), records(baseline), "Reset records mismatch");
    equal(reset.runs, [], "Reset history mismatch");
    equal(reset.generation, injected.generation + 1, "Reset generation mismatch");
  }
  return { cycles: 3, exceptionsPerCycle: 4, modelRequests: 0 } as const;
}
