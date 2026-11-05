/** Opt in: node --import tsx --test tests/pg-local.integration.ts */
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { Store } from "../src/server/db/store";
import { DatabaseQueryError, DatabaseTimeout, DatabaseUnavailable, PgDatabase, pgPoolOptions } from "../src/server/db/pg";
import { stubInvestigator } from "../src/server/investigation/stub";
import { summarize } from "../src/domain/finance";
import { injectedDataset } from "../src/fixtures/scenarios";
import type { DemoState, InvestigationInput } from "../src/contracts";
import { localTestConnection, scopedDatabase, verifyTarget } from "./helpers/pg-local";
const schema = "app01_test_" + randomUUID().replaceAll("-", "");
const control = new Pool(pgPoolOptions({ ...localTestConnection, application_name: schema + "_control" }));
const primary = scopedDatabase(schema);
const store = new Store(primary.db);
const databases = [primary];
const children: ChildProcess[] = [];
let created = false;
function fresh() { const result = scopedDatabase(schema); databases.push(result); return result; }
function receive(child: ChildProcess): Promise<Record<string, unknown>> {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("Worker response timeout")); }, 10000);
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); child.off("error", onError); };
    const onMessage = (value: Record<string, unknown>) => { cleanup(); if (value.error)
      reject(new Error(String(value.error)));
    else
      resolveMessage(value); };
    const onExit = () => { cleanup(); reject(new Error("Worker exited before response")); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    child.once("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}
async function worker() {
  const child = fork(resolve("tests/helpers/pg-local-worker.ts"), [schema], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  children.push(child);
  const ready = await receive(child);
  assert.equal(ready.ready, true);
  return {
    child, pid: Number(ready.pid), processId: Number(ready.processId),
    call: async (message: Record<string, unknown>) => {
      const response = receive(child);
      child.send(message);
      return (await response).value;
    },
  };
}
type Worker = Awaited<ReturnType<typeof worker>>;
async function raceWithLock(workers: Worker[], action: Record<string, unknown>) {
  assert.equal(new Set(workers.map(w => w.pid)).size, workers.length);
  assert.equal(new Set(workers.map(w => w.processId)).size, workers.length);
  let unlock!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>(r => { locked = r; });
  const release = new Promise<void>(r => { unlock = r; });
  const holder = primary.db.transaction(async (tx) => {
    await tx.query("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE");
    locked();
    await release;
  });
  await gate;
  const work = Promise.all(workers.map(w => w.call(action)));
  // Observe actual server lock waits before releasing the gate.
  try {
    const deadline = Date.now() + 2000;
    let waiting = 0;
    do {
      const rows = await control.query<{
        count: number;
      }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1 AND application_name = $2 AND pid = ANY($3::int[]) AND wait_event_type = 'Lock'", [localTestConnection.database, schema, workers.map(w => w.pid)]);
      waiting = rows.rows[0].count;
      if (waiting === workers.length)
        break;
      await delay(10);
    } while (Date.now() < deadline);
    assert.equal(waiting, workers.length, "all workers must contend on the real row lock");
  }
  finally {
    unlock();
    await holder;
  }
  return work;
}
before(async () => {
  await verifyTarget(control);
  await control.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  // Independent pools race first-time migration/bootstrap.
  await Promise.all([store.initialize(), new Store(fresh().db).initialize()]);
});
beforeEach(async () => { await store.reset(); });
after(async () => {
  for (const child of children)
    if (child.connected)
      child.disconnect();
  for (const child of children)
    if (child.exitCode === null)
      child.kill();
  await Promise.all(databases.map(d => d.db.close()));
  try {
    if (created)
      await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
  finally {
    await control.end();
  }
});
const options = { timeout: 20000 };
test("real pg: transaction pins a backend and rolls back SQL and application failures", options, async () => {
  await assert.rejects(primary.db.transaction(async (tx) => {
    const a = (await tx.query<{
      pid: number;
    }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await tx.query("INSERT INTO vendors VALUES ($1, $2)", ["rollback-vendor", JSON.stringify({ id: "rollback-vendor", name: "Synthetic", category: "test" })]);
    const b = (await tx.query<{
      pid: number;
    }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    assert.equal(a, b);
    await tx.query("SELECT 1 / 0");
  }), DatabaseQueryError);
  await assert.rejects(primary.db.transaction(async (tx) => {
    await tx.query("INSERT INTO vendors VALUES ($1, $2)", ["rollback-application", "{}"]);
    throw new Error("application validation failed");
  }), /application validation failed/);
  const other = fresh();
  const rows = await other.db.transaction(tx => tx.query("SELECT id FROM vendors WHERE id = ANY($1::text[])", [["rollback-vendor", "rollback-application"]]));
  assert.equal(rows.rows.length, 0);
});
test("real pg: independent processes cannot inject twice (three cycles)", options, async () => {
  const workers = await Promise.all([worker(), worker()]);
  for (let cycle = 0; cycle < 3; cycle++) {
    if (cycle)
      await store.reset();
    const results = await raceWithLock(workers, { action: "inject" }) as {
      changed: boolean;
    }[];
    assert.deepEqual(results.map(r => r.changed).sort(), [false, true]);
    const state = await store.state();
    assert.equal(state.dataset.payments.length, 7);
    assert.equal(state.exceptions.length, 4);
    assert.equal(state.runs.length, 4);
    assert.equal(new Set(state.runs.map(r => r.id)).size, 4);
    assert.deepEqual([...state.summaries].sort((a, b) => a.vendorId.localeCompare(b.vendorId)), summarize(injectedDataset()).sort((a, b) => a.vendorId.localeCompare(b.vendorId)));
  }
});
test("real pg: concurrent cross-process claims have one winner", options, async () => {
  await store.inject();
  const run = (await store.state()).runs[0];
  const workers = await Promise.all([worker(), worker()]);
  const results = await raceWithLock(workers, { action: "claim", id: run.id });
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await store.state()).runs.find(r => r.id === run.id)?.state, "running");
});
test("real pg: reset invalidates another process's claimed in-flight result", options, async () => {
  const a = await worker(), b = await worker();
  await a.call({ action: "inject" });
  const run = (await store.state()).runs[0];
  const input = await a.call({ action: "claim", id: run.id }) as InvestigationInput;
  assert.ok(input);
  await b.call({ action: "reset" });
  const reset = await store.state();
  assert.equal(reset.dataset.payments.length, 2);
  assert.equal(reset.runs.length, 0);
  await b.call({ action: "inject" });
  const result = await stubInvestigator.investigate(input, new AbortController().signal);
  assert.equal(await a.call({ action: "finish", id: run.id, generation: input.generation, result }), false);
  const state = await store.state();
  assert.equal(state.generation, input.generation + 1);
  assert.ok(state.runs.every(r => r.state === "pending" && r.generation === state.generation));
});
test("real pg: review is idempotent and persists through independent pools/processes", options, async () => {
  await store.inject();
  const run = (await store.state()).runs[0];
  const input = await store.claim(run.id);
  assert.ok(input);
  await store.finish(run.id, run.generation, await stubInvestigator.investigate(input, new AbortController().signal));
  const workers = await Promise.all([worker(), worker()]);
  const results = await raceWithLock(workers, { action: "review", id: run.id }) as {
    changed: boolean;
  }[];
  assert.deepEqual(results.map(r => r.changed).sort(), [false, true]);
  const timestamp = (await store.state()).runs.find(r => r.id === run.id)?.reviewedAt;
  assert.ok(timestamp);
  const independent = fresh();
  const reader = new Store(independent.db);
  assert.equal((await reader.state()).runs.find(r => r.id === run.id)?.reviewedAt, timestamp);
  await independent.db.close();
  const reopened = await worker();
  assert.equal((await reopened.call({ action: "state" }) as DemoState).runs.find(r => r.id === run.id)?.reviewedAt, timestamp);
});
test("real pg: failed operations reject instead of returning local data", options, async () => {
  await assert.rejects(primary.db.transaction(tx => tx.query("SELECT * FROM app01_deliberately_missing_table")), DatabaseQueryError);
  await primary.db.transaction(async (tx) => {
    const row = (await tx.query<{
      database: string;
    }>("SELECT current_database() AS database")).rows[0];
    assert.equal(row.database, localTestConnection.database);
  });
});
test("real pg: terminating an idle backend permits the next request and a fresh pool to recover", options, async () => {
  await store.inject();
  const old = fresh();
  const pid = await old.db.transaction(async (tx) => (await tx.query<{
    pid: number;
  }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  const event = new Promise<void>((resolveEvent, reject) => {
    const timer = setTimeout(() => reject(new Error("No real idle-pool error event")), 5000);
    old.pool.once("error", () => { clearTimeout(timer); resolveEvent(); });
  });
  const result = await control.query<{
    terminated: boolean;
  }>("SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid = $1 AND datname = $2 AND usename = $3 AND application_name = $4", [pid, localTestConnection.database, localTestConnection.user, schema]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].terminated, true);
  await event;
  // pg-pool removes the broken idle client; the next explicit request replaces it.
  const replacement = await old.db.transaction(async (tx) => (await tx.query<{
    pid: number;
  }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  assert.notEqual(replacement, pid);
  assert.equal((await new Store(old.db).state()).dataset.payments.length, 7);
  await old.db.close();
  const recovered = fresh();
  const newPid = await recovered.db.transaction(async (tx) => (await tx.query<{
    pid: number;
  }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  assert.notEqual(newPid, pid);
  const state = await new Store(recovered.db).state();
  assert.equal(state.dataset.payments.length, 7);
  assert.equal(state.runs.length, 4);
  await assert.rejects(old.db.transaction(async () => { }), DatabaseUnavailable);
});
test("real pg: lock and statement timeouts are distinct from outages and preserve usable clients", options, async () => {
  const pool = new Pool(pgPoolOptions({ ...localTestConnection, application_name: schema }, { max: 1, lock_timeout: 100, statement_timeout: 500 }));
  const db = new PgDatabase(pool);
  const original = await db.transaction(async (tx) => (await tx.query<{
    pid: number;
  }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  let unlock!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>(r => { locked = r; });
  const release = new Promise<void>(r => { unlock = r; });
  const holder = primary.db.transaction(async (tx) => {
    await tx.query("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE");
    locked();
    await release;
  });
  try {
    await gate;
    await assert.rejects(db.transaction(async (tx) => {
      await tx.query("SELECT set_config('search_path', $1, true)", [schema + ",pg_catalog"]);
      await tx.query("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE");
    }), (error: unknown) => error instanceof DatabaseTimeout && error.sqlstate === "55P03");
    unlock();
    await holder;
    await assert.rejects(db.transaction(tx => tx.query("SELECT pg_sleep(1)")), (error: unknown) => error instanceof DatabaseTimeout && error.sqlstate === "57014");
    const pid = await db.transaction(async (tx) => (await tx.query<{
      pid: number;
    }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    assert.equal(pid, original, "successful rollbacks must retain a healthy connection");
  }
  finally {
    unlock();
    await holder;
    await db.close();
  }
});
test("real pg: an active connection loss rolls back without replay and later work can recover", options, async () => {
  const target = fresh();
  let callbacks = 0;
  await assert.rejects(target.db.transaction(async (tx) => {
    callbacks++;
    await tx.query("INSERT INTO vendors VALUES ($1, $2)", ["interrupted-test-vendor", "{}"]);
    const pid = (await tx.query<{
      pid: number;
    }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const result = await control.query<{
      terminated: boolean;
    }>("SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid = $1 AND datname = $2 AND usename = $3 AND application_name = $4", [pid, localTestConnection.database, localTestConnection.user, schema]);
    assert.equal(result.rows[0]?.terminated, true);
    await tx.query("SELECT 1");
  }), DatabaseUnavailable);
  assert.equal(callbacks, 1);
  const rows = await target.db.transaction(tx => tx.query("SELECT id FROM vendors WHERE id = $1", ["interrupted-test-vendor"]));
  assert.equal(rows.rows.length, 0);
});
test("real pg: retries across processes are predecessor-idempotent and reset guards results", options, async () => {
  await store.inject(Date.now() - 61000);
  const old = (await store.state()).runs[0];
  const a = await worker(), b = await worker();
  const raced = await raceWithLock([a, b], { action: "retry", id: old.id }) as {
    changed: boolean;
  }[];
  assert.deepEqual(raced.map(x => x.changed).sort(), [false, true]);
  const history = (await store.state()).runs.filter(x => x.exceptionId === old.exceptionId);
  assert.equal(history.length, 2);
  const retry = history[1];
  const claimed = await raceWithLock([a, b], { action: "claim", id: retry.id });
  assert.equal(claimed.filter(Boolean).length, 1);
  const input = claimed.find(Boolean) as InvestigationInput;
  await b.call({ action: "reset" });
  await store.inject();
  const result = await stubInvestigator.investigate(input, new AbortController().signal);
  assert.equal(await a.call({ action: "finish", id: retry.id, generation: retry.generation, result }), false);
  assert.equal((await store.state()).runs.length, 4);
});
test("real pg: privileged retrieval login fails closed; read-only role cannot write", options, async () => {
  const { assertReadOnly, assertApplication } = await import('../src/server/db/permissions');
  await assert.rejects(primary.db.transaction(assertReadOnly), /Read-only/);
  await assert.rejects(primary.db.transaction(assertApplication), /Application/);
  // Existing PostgreSQL built-in role; no role creation, grants or credentials.
  await primary.db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE pg_read_all_data');
    await assertReadOnly(tx);
    assert.equal((await tx.query('SELECT id FROM payments')).rows.length, 2);
  });
  await assert.rejects(primary.db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE pg_read_all_data');
    await tx.exec('DELETE FROM payments');
  }), DatabaseQueryError);
  await assert.rejects(primary.db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE pg_read_all_data');
    await tx.exec('CREATE TABLE forbidden(id integer)');
  }), DatabaseQueryError);
});

test("real pg: populated 001 upgrades without changing records, results or reviews", options, async () => {
  const { migrations } = await import('../src/server/db/migrations/bundled');
  const { runPending } = await import('../src/server/investigation/run');
  await store.inject(); await runPending(store);
  await store.review((await store.state()).runs[0].id);
  const expected = await store.state();
  const legacySchema = 'app01_test_' + randomUUID().replaceAll('-', '');
  const legacy = scopedDatabase(legacySchema);
  await control.query(`CREATE SCHEMA "${legacySchema}"`);
  try {
    await legacy.db.transaction(async tx => {
      await tx.exec(migrations[0]);
      await tx.exec(`UPDATE demo_state SET generation=${expected.generation}, injected=true`);
      for (const [table, columns] of [
        ['vendors', 'id,payload'], ['invoices', 'id,vendor_id,payload'],
        ['payments', 'id,vendor_id,payload'], ['vendor_notes', 'id,vendor_id,payload'], ['exceptions', 'id,payload'],
      ]) await tx.exec(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM "${schema}".${table}`);
      await tx.exec(`INSERT INTO investigation_runs SELECT id,exception_id,generation,status,deadline_at,
        payload || jsonb_build_object('id',id,'exceptionId',exception_id,'generation',generation,'state',status)
        FROM "${schema}".investigation_runs`);
    });
    const upgraded = new Store(legacy.db);
    await Promise.all([upgraded.initialize(), upgraded.initialize()]);
    assert.deepEqual(await upgraded.state(), expected);
    await upgraded.assertVersion();
    const links = await legacy.db.transaction(tx => tx.query<{ count: number }>('SELECT count(*)::int AS count FROM note_payments'));
    assert.equal(links.rows[0].count, expected.dataset.notes.reduce((n, r) => n + r.paymentIds.length, 0));
  } finally {
    await legacy.db.close();
    await control.query(`DROP SCHEMA "${legacySchema}" CASCADE`);
  }
});
