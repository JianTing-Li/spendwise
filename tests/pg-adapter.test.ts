import { EventEmitter } from "node:events";
import { Client, type Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseConflict, DatabaseQueryError, DatabaseTimeout, PgDatabase, pgPoolOptions, pgTestDefaults } from "../src/server/db/pg";
import type { DatabaseTransaction } from "../src/server/db/database";
afterEach(() => vi.unstubAllEnvs());
function fixture(failures: string[] = [], code?: string) {
  const calls: {
    sql: string;
    parameters?: unknown[];
    client: number;
  }[] = [];
  const releases: boolean[] = [];
  let serial = 0;
  const pool = Object.assign(new EventEmitter(), {
    connect: vi.fn(async () => {
      const client = ++serial;
      return Object.assign(new EventEmitter(), {
        query: async (sql: string, parameters?: unknown[]) => {
          calls.push({ sql, parameters, client });
          if (failures.includes(sql))
            throw Object.assign(new Error("secret driver details"), { code });
          return { rows: [{ value: 7 }] };
        },
        release: (discard: boolean) => { releases.push(discard); },
      }) as unknown as PoolClient;
    }),
    end: vi.fn(async () => { }),
  });
  const db = new PgDatabase(pool as unknown as Pool);
  return { db, pool, calls, releases };
}
describe("pooled pg adapter control flow (no live database)", () => {
  it("pins each transaction to one client and forwards parameters unchanged", async () => {
    const { db, calls, releases, pool } = fixture();
    const parameters = ["Robert'); DROP TABLE payments; --", 100];
    expect(await db.transaction(async (tx) => {
      const result = await tx.query<{
        value: number;
      }>("SELECT $1, $2", parameters);
      await tx.exec("SELECT 1; SELECT 2");
      return result.rows[0].value;
    })).toBe(7);
    expect(calls.map(c => c.sql)).toEqual(["BEGIN", "SELECT $1, $2", "SELECT 1; SELECT 2", "COMMIT"]);
    expect(calls.every(c => c.client === 1)).toBe(true);
    expect(calls[1].parameters).toBe(parameters);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(releases).toEqual([false]);
    await db.close();
  });
  it("rolls back application errors and releases the connection", async () => {
    const { db, calls, releases } = fixture();
    const error = new Error("application validation");
    await expect(db.transaction(async () => { throw error; })).rejects.toBe(error);
    expect(calls.map(c => c.sql)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(releases).toEqual([false]);
    await db.close();
  });
  it.each(["BEGIN", "SELECT $1", "COMMIT", "ROLLBACK"])("discards on %s failure without exposing driver details", async (failure) => {
    const { db, calls, releases } = fixture([failure]);
    await expect(db.transaction(async (tx) => {
      if (failure === "ROLLBACK")
        throw new Error("application error");
      await tx.query("SELECT $1", [1]);
    })).rejects.toThrow("Database unavailable");
    expect(releases).toEqual([true]);
    expect(calls.filter(c => c.sql === "COMMIT")).toHaveLength(failure === "COMMIT" ? 1 : 0);
    await db.close();
  });
  it("marks a connection failure during COMMIT as an unknown outcome", async () => {
    const { db, pool } = fixture(["COMMIT"]);
    try {
      await expect(db.transaction(tx => tx.query("SELECT 1"))).rejects.toMatchObject({ name: "DatabaseUnavailable", outcomeUnknown: true });
      expect(pool.connect).toHaveBeenCalledTimes(1);
    }
    finally {
      await db.close();
    }
  });
  it("does not commit a swallowed query failure", async () => {
    const { db, calls } = fixture(["bad"]);
    await expect(db.transaction(async (tx) => {
      try {
        await tx.query("bad");
      }
      catch { /* deliberately swallowed */ }
    })).rejects.toThrow("Database unavailable");
    expect(calls.map(c => c.sql)).toEqual(["BEGIN", "bad", "ROLLBACK"]);
    await db.close();
  });
  it("fails acquisition explicitly with no retry or fallback", async () => {
    const { db, pool, releases } = fixture();
    pool.connect.mockRejectedValueOnce(new Error("secret connection URL"));
    const work = vi.fn();
    await expect(db.transaction(work)).rejects.toThrow("Database unavailable");
    expect(work).not.toHaveBeenCalled();
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(releases).toEqual([]);
    await db.close();
  });
  it("handles idle pool errors without disabling future transactions", async () => {
    const { db, pool } = fixture();
    pool.emit("error", new Error("secret details"));
    await db.transaction(async (tx) => { await tx.query("SELECT 1"); });
    expect(pool.connect).toHaveBeenCalledTimes(1);
    await db.close();
    await db.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
    await expect(db.transaction(async () => { })).rejects.toThrow("Database unavailable");
  });
  it("does not replay a failed transaction; a later request and a fresh pool can succeed", async () => {
    const old = fixture();
    const fresh = fixture();
    try {
      old.pool.connect.mockRejectedValueOnce(new Error("unreachable"));
      const work = vi.fn(async (tx: DatabaseTransaction) => { await tx.query("SELECT 1"); });
      await expect(old.db.transaction(work)).rejects.toThrow("Database unavailable");
      expect(work).not.toHaveBeenCalled();
      expect(old.pool.connect).toHaveBeenCalledTimes(1);
      await old.db.transaction(work);
      expect(work).toHaveBeenCalledTimes(1);
      await old.db.close();
      await fresh.db.transaction(work);
      expect(work).toHaveBeenCalledTimes(2);
      await expect(old.db.transaction(work)).rejects.toThrow("Database unavailable");
    }
    finally {
      await old.db.close();
      await fresh.db.close();
    }
  });
  it.each([
    ["55P03", DatabaseTimeout], ["57014", DatabaseTimeout],
    ["40P01", DatabaseConflict], ["40001", DatabaseConflict],
    ["23505", DatabaseQueryError], ["42601", DatabaseQueryError],
  ] as const)("classifies SQLSTATE %s and retains the client after rollback", async (code, ErrorType) => {
    const { db, releases, calls } = fixture(["bad"], code);
    try {
      await expect(db.transaction(tx => tx.query("bad"))).rejects.toBeInstanceOf(ErrorType);
      expect(calls.map(c => c.sql)).toEqual(["BEGIN", "bad", "ROLLBACK"]);
      expect(releases).toEqual([false]);
      await db.transaction(tx => tx.query("good"));
      expect(releases).toEqual([false, false]);
    }
    finally {
      await db.close();
    }
  });
  it("rejects escaped transaction handles", async () => {
    const { db, calls } = fixture();
    let escaped: DatabaseTransaction | undefined;
    await db.transaction(async (tx) => { escaped = tx; });
    await expect(escaped!.query("SELECT 1")).rejects.toThrow("Transaction has ended");
    expect(calls.map(c => c.sql)).toEqual(["BEGIN", "COMMIT"]);
    await db.close();
  });
  it("keeps independent concurrent transactions on separate clients", async () => {
    const { db, calls, releases } = fixture();
    await Promise.all([1, 2].map(value => db.transaction(async (tx) => {
      await tx.query("SELECT $1", [value]);
    })));
    for (const client of [1, 2])
      expect(calls.filter(c => c.client === client).map(c => c.sql)).toEqual(["BEGIN", "SELECT $1", "COMMIT"]);
    expect(releases).toEqual([false, false]);
    await db.close();
  });
});
describe("initial local pool limits", () => {
  it("applies configurable bounded test defaults without changing SSL settings", () => {
    const ssl = { rejectUnauthorized: true };
    expect(pgPoolOptions({ host: "localhost", ssl })).toEqual({ host: "localhost", ssl, ...pgTestDefaults, options: " " });
    expect(pgPoolOptions({}, { max: 2 }).max).toBe(2);
    expect(pgPoolOptions({ statement_timeout: 0 }).statement_timeout).toBe(5000);
  });
  it.each([0, -1, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects unbounded/invalid values: %s", value => {
    expect(() => pgPoolOptions({}, { statement_timeout: value })).toThrow("positive safe integers");
  });
  it("rejects PGOPTIONS and prevents later environment changes bypassing limits", () => {
    vi.stubEnv("PGOPTIONS", "-c statement_timeout=0");
    expect(() => pgPoolOptions({})).toThrow("startup options");
    vi.stubEnv("PGOPTIONS", "");
    const options = pgPoolOptions({});
    vi.stubEnv("PGOPTIONS", "-c lock_timeout=0");
    const client = new Client(options) as unknown as {
      connectionParameters: {
        options: string;
        statement_timeout: number;
      };
    };
    expect(client.connectionParameters.options).toBe(" ");
    expect(client.connectionParameters.statement_timeout).toBe(5000);
  });
  it("blocks startup and URL timeout overrides", () => {
    expect(() => pgPoolOptions({ options: "-c statement_timeout=0" })).toThrow("startup options");
    for (const name of ["options", "statement_timeout", "lock_timeout", "connect_timeout", "idle_in_transaction_session_timeout"])
      expect(() => pgPoolOptions({ connectionString: `postgresql://localhost/synthetic?${name}=0` })).toThrow("timeout overrides");
  });
});
