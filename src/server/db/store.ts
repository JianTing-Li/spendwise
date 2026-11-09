import { RunError } from "../../investigation/budget";
import { investigatorMode, normalizeResult } from "../investigation/result";
import type { Database, DatabaseTransaction } from "./database";
import { initializeLocalReader } from "./local-reader";
import { migrate } from "./migrate";
import { Dataset, DemoState, Exception, Run, InvestigationResult, type InvestigationInput, } from "../../contracts";
import { baseline, injectedDataset } from "../../fixtures/scenarios";
import { detect, summarize, validateDataset } from "../../domain/finance";
export class Store {
  constructor(readonly db: Database, readonly reader?: Database) { }
  async assertVersion() {
    await this.db.transaction(async (tx) => {
      const versions = (await tx.query<{
        version: number;
      }>("SELECT version FROM schema_migrations ORDER BY version")).rows.map(r => r.version);
      if (versions.join(",") !== "1,2")
        throw new Error("Database migration required");
    });
  }
  async initialize() {
    await migrate(this.db);
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE");
      const existing = await tx.query("SELECT id FROM vendors LIMIT 1");
      if (!existing.rows.length)
        await this.writeDataset(tx, baseline);
    });
    if (this.db.dialect !== "postgres") await initializeLocalReader(this.db);
  }
  private async writeDataset(tx: DatabaseTransaction, input: Dataset) {
    const data = validateDataset(input);
    for (const row of data.vendors)
      await tx.query("INSERT INTO vendors (id,payload) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload", [row.id, JSON.stringify(row)]);
    for (const [table, rows] of [
      ["invoices", data.invoices],
      ["payments", data.payments],
      ["vendor_notes", data.notes],
    ] as const) {
      // table names are a fixed application allowlist, never caller/model input.
      for (const row of rows)
        await tx.query(`INSERT INTO ${table} (id,vendor_id,payload) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`, [row.id, row.vendorId, JSON.stringify(row)]);
    }
    await tx.exec("DELETE FROM note_payments; DELETE FROM note_invoices;");
    for (const note of data.notes) {
      for (const id of note.paymentIds)
        await tx.query("INSERT INTO note_payments VALUES ($1,$2) ON CONFLICT DO NOTHING", [note.id, id]);
      for (const id of note.invoiceIds)
        await tx.query("INSERT INTO note_invoices VALUES ($1,$2) ON CONFLICT DO NOTHING", [note.id, id]);
    }
  }
  async state(): Promise<DemoState> {
    return this.db.transaction(async (tx) => {
      // One coherent, read-only snapshot; polling never writes or locks reset.
      await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const meta = (await tx.query<{ generation: number; injected: boolean }>(
        "SELECT generation, injected FROM demo_state WHERE id = 1")).rows[0];
      const records = async (table: string) => (await tx.query<{
        payload: unknown;
      }>(`SELECT payload FROM ${table} ORDER BY id`)).rows.map((r) => r.payload);
      const dataset = Dataset.parse({
        vendors: await records("vendors"),
        invoices: await records("invoices"),
        payments: await records("payments"),
        notes: await records("vendor_notes"),
      });
      return DemoState.parse({
        ...meta,
        dataset,
        summaries: summarize(dataset),
        exceptions: (await records("exceptions")).map((x) => Exception.parse(x)),
        runs: (await tx.query<RunRow>("SELECT * FROM investigation_runs ORDER BY exception_id, attempt")).rows.map(row => effectiveRun(row)),
      });
    });
  }
  async inject(acceptedAt = Date.now()) {
    const mode = investigatorMode();
    return this.db.transaction(async (tx) => {
      const meta = (await tx.query<{
        generation: number;
        injected: boolean;
      }>("SELECT generation, injected FROM demo_state WHERE id = 1 FOR UPDATE")).rows[0];
      if (meta.injected)
        return { generation: meta.generation, changed: false };
      const data = injectedDataset();
      await this.writeDataset(tx, data);
      for (const exception of detect(data)) {
        await tx.query("INSERT INTO exceptions VALUES ($1, $2) ON CONFLICT DO NOTHING", [exception.id, JSON.stringify(exception)]);
        const run = Run.parse({
          id: `run:${meta.generation}:${exception.id}`,
          exceptionId: exception.id,
          generation: meta.generation,
          mode,
          state: "pending",
          findings: [],
          error: null,
          reviewedAt: null,
          toolExecutions: 0,
          modelRequests: 0,
        });
        await tx.query("INSERT INTO investigation_runs (id,exception_id,generation,status,deadline_at,payload) VALUES ($1,$2,$3,'pending',$4,$5) ON CONFLICT DO NOTHING", [
          run.id,
          exception.id,
          meta.generation,
          new Date(acceptedAt + 60000).toISOString(),
          encodeRun(run),
        ]);
      }
      await tx.query("UPDATE demo_state SET injected = true WHERE id = 1");
      return { generation: meta.generation, changed: true };
    });
  }
  async claim(id: string): Promise<InvestigationInput | null> {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE");
      const row = (await tx.query<RunRow & {
        exception: unknown;
      }>("SELECT r.*, e.payload AS exception FROM investigation_runs r JOIN exceptions e ON e.id = r.exception_id WHERE r.generation = (SELECT generation FROM demo_state WHERE id=1) AND r.id = $1 AND r.status = 'pending' AND r.deadline_at > clock_timestamp()", [id])).rows[0];
      if (!row)
        return null;
      const run = decodeRun(row);
      await tx.query("UPDATE investigation_runs SET status = 'running', payload = $2 WHERE id = $1", [id, encodeRun(run)]);
      const deadline = new Date(row.deadline_at).getTime();
      return {
        exception: Exception.parse(row.exception),
        generation: run.generation,
        deadlineAt: new Date(deadline).toISOString(),
        acceptedAt: new Date(deadline - 60000).toISOString(),
      };
    });
  }
  async finish(id: string, generation: number, result: InvestigationResult): Promise<boolean> {
    const parsed = normalizeResult(InvestigationResult.parse(result));
    if (["pending", "running"].includes(parsed.state))
      throw new Error("invalid_result");
    return this.db.transaction(async (tx) => {
      const meta = (await tx.query<{
        generation: number;
      }>("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE")).rows[0];
      if (meta.generation !== generation)
        return false;
      const row = (await tx.query<RunRow>("SELECT * FROM investigation_runs WHERE id = $1 AND status = 'running'", [id])).rows[0];
      if (!row)
        return false;
      const deadline = new Date(row.deadline_at).getTime();
      const final = Date.now() >= deadline
        ? { ...parsed, state: "incomplete", findings: [], error: "deadline" }
        : parsed;
      const previous = decodeRun(row);
      if (previous.mode !== parsed.mode) throw new Error("invalid_result");
      const run = Run.parse({ ...previous, ...final,
        toolExecutions: Math.max(previous.toolExecutions, parsed.toolExecutions),
        modelRequests: Math.max(previous.modelRequests, parsed.modelRequests) });
      await tx.query("UPDATE investigation_runs SET status = $2, payload = $3 WHERE id = $1", [id, run.state, encodeRun(run)]);
      // Roll back a success if persistence itself exhausted the deadline.
      if (run.state === "completed" && Date.now() >= deadline)
        throw new Error("deadline");
      return true;
    });
  }
  async retry(predecessorId: string, acceptedAt = Date.now()) {
    return this.db.transaction(async (tx) => {
      const meta = (await tx.query<{
        generation: number;
      }>("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE")).rows[0];
      // Mutations materialize expiry; GET only derives it.
      await tx.query("UPDATE investigation_runs SET status='incomplete', payload=jsonb_set(payload,'{error}','\"deadline\"'::jsonb) WHERE generation=$1 AND status IN ('pending','running') AND deadline_at<=clock_timestamp()", [meta.generation]);
      const previous = (await tx.query<RunRow>("SELECT * FROM investigation_runs WHERE id=$1 AND generation=$2", [predecessorId, meta.generation])).rows[0];
      if (!previous)
        throw new Error("invalid_retry");
      const existing = (await tx.query<{
        id: string;
      }>("SELECT id FROM investigation_runs WHERE predecessor_id=$1", [predecessorId])).rows[0];
      if (existing)
        return { generation: meta.generation, changed: false };
      const latest = (await tx.query<{
        id: string;
      }>("SELECT id FROM investigation_runs WHERE exception_id=$1 AND generation=$2 ORDER BY attempt DESC LIMIT 1", [previous.exception_id, meta.generation])).rows[0];
      if (latest.id !== previous.id || previous.attempt >= 3 || !["failed", "incomplete", "cancelled"].includes(previous.status))
        throw new Error("invalid_retry");
      const run = Run.parse({ ...decodeRun(previous), id: `run:${meta.generation}:${previous.exception_id}:attempt-${previous.attempt + 1}`, state: "pending", findings: [], error: null, reviewedAt: null, toolExecutions: 0, modelRequests: 0 });
      await tx.query("INSERT INTO investigation_runs (id,exception_id,generation,status,deadline_at,payload,attempt,predecessor_id) VALUES ($1,$2,$3,'pending',$4,$5,$6,$7)", [run.id, run.exceptionId, run.generation, new Date(acceptedAt + 60000).toISOString(), encodeRun(run), previous.attempt + 1, predecessorId]);
      return { generation: meta.generation, changed: true };
    });
  }
  /** Short atomic reservation before work. Never replay after uncertain commit. */
  async charge(id: string, generation: number, counter: "toolExecutions" | "modelRequests", amount = 1) {
    if (!Number.isInteger(amount) || amount < 1 || amount > 10) throw new Error("invalid_counter");
    return this.db.transaction(async tx => {
      const meta = (await tx.query<{generation: number}>("SELECT generation FROM demo_state WHERE id=1 FOR SHARE")).rows[0];
      if (meta.generation !== generation) throw new RunError("stale_generation");
      const row = (await tx.query<RunRow>("SELECT * FROM investigation_runs WHERE id=$1 AND generation=$2 AND status='running' AND deadline_at>clock_timestamp() FOR UPDATE", [id,generation])).rows[0];
      if (!row) throw new RunError("deadline");
      const run = decodeRun(row);
      const limit = counter === "toolExecutions" ? 8 : 10;
      if (run[counter] + amount > limit) throw new RunError(counter === "toolExecutions" ? "tool_limit" : "model_limit");
      run[counter] += amount;
      await tx.query("UPDATE investigation_runs SET payload=$2 WHERE id=$1", [id,encodeRun(run)]);
      return run[counter];
    });
  }
  async active(id: string, generation: number) {
    return (await this.activeRuns([id], generation)).includes(id);
  }
  async activeRuns(ids: string[], generation: number): Promise<string[]> {
    return this.db.transaction(async tx => (await tx.query<{id: string}>(
      "SELECT r.id FROM investigation_runs r JOIN demo_state d ON d.id=1 AND d.generation=r.generation WHERE r.id=ANY($1::text[]) AND r.generation=$2 AND r.status='running' AND r.deadline_at>clock_timestamp()", [ids,generation])).rows.map(r => r.id));
  }
  async reset() {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE");
      await tx.exec("DELETE FROM note_payments; DELETE FROM note_invoices; DELETE FROM investigation_runs; DELETE FROM exceptions; DELETE FROM vendor_notes; DELETE FROM payments; DELETE FROM invoices; DELETE FROM vendors;");
      await this.writeDataset(tx, baseline);
      const meta = (await tx.query<{
        generation: number;
      }>("UPDATE demo_state SET generation = generation + 1, injected = false WHERE id = 1 RETURNING generation")).rows[0];
      return { generation: meta.generation, changed: true };
    });
  }
  async review(id: string) {
    return this.db.transaction(async (tx) => {
      const meta = (await tx.query<{
        generation: number;
      }>("SELECT generation FROM demo_state WHERE id = 1 FOR UPDATE")).rows[0];
      const row = (await tx.query<RunRow>("SELECT * FROM investigation_runs WHERE id = $1 AND generation = $2 AND status = 'completed'", [id, meta.generation])).rows[0];
      if (!row)
        throw new Error("invalid_review");
      const run = decodeRun(row);
      if (run.reviewedAt)
        return { generation: meta.generation, changed: false };
      await tx.query("UPDATE investigation_runs SET payload = $2 WHERE id = $1", [id, encodeRun({ ...run, reviewedAt: new Date().toISOString() })]);
      return { generation: meta.generation, changed: true };
    });
  }
}
type RunRow = {
  id: string;
  exception_id: string;
  generation: number;
  status: string;
  payload: unknown;
  deadline_at: Date;
  attempt: number;
};
function decodeRun(row: RunRow) {
  return Run.parse({ ...(row.payload as object), id: row.id, exceptionId: row.exception_id, generation: row.generation, state: row.status });
}
function encodeRun(run: Run) {
  const { id, exceptionId, generation, state, ...payload } = run;
  void id;
  void exceptionId;
  void generation;
  void state;
  return JSON.stringify(payload);
}

function effectiveRun(row: RunRow) {
  const run = decodeRun(row);
  return ["pending", "running"].includes(run.state) && new Date(row.deadline_at).getTime() <= Date.now()
    ? { ...run, state: "incomplete" as const, error: "deadline" as const, findings: [] }
    : run;
}
