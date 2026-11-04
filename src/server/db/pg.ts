import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import type { Database, DatabaseTransaction } from "./database";

export type PgLimits = {
  max: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
  lock_timeout: number;
  idle_in_transaction_session_timeout: number;
};

/** Initial local test defaults, not validated production capacity settings. */
export const pgTestDefaults: Readonly<PgLimits> = Object.freeze({
  max: 4,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
  lock_timeout: 3000,
  idle_in_transaction_session_timeout: 5000,
});

export class DatabaseUnavailable extends Error {
  constructor() {
    // Driver messages can contain connection details; do not expose them.
    super("Database unavailable");
    this.name = "DatabaseUnavailable";
  }
}

/** Pure configuration builder; it neither connects nor reads environment values. */
export function pgPoolOptions(
  connection: PoolConfig,
  limits: Partial<PgLimits> = {},
): PoolConfig {
  const bounded = { ...pgTestDefaults, ...limits };
  for (const value of Object.values(bounded))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Database limits must be positive safe integers");
  // pg lets connection-string parameters override object configuration.
  // Startup options could also disable the server-side limits.
  if (connection.options) throw new Error("Database startup options unavailable");
  if (connection.connectionString) {
    let url: URL;
    try { url = new URL(connection.connectionString); }
    catch { throw new Error("Invalid database URL"); }
    for (const name of url.searchParams.keys())
      if (/^(options|connect_timeout|connectionTimeoutMillis|statement_timeout|lock_timeout|idle_in_transaction_session_timeout)$/i.test(name))
        throw new Error("Database URL timeout overrides unavailable");
  }
  return { ...connection, ...bounded };
}

/** No application mode selection or migration changes in this adapter-only WIP. */
export class PgDatabase implements Database {
  private faulted = false;
  private closed = false;
  private readonly onIdleError = () => { this.faulted = true; };

  constructor(private readonly pool: Pool) {
    // An idle-client failure must not become an unhandled EventEmitter error.
    pool.on("error", this.onIdleError);
  }

  static create(connection: PoolConfig, limits?: Partial<PgLimits>) {
    return new PgDatabase(new Pool(pgPoolOptions(connection, limits)));
  }

  async transaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    if (this.closed || this.faulted) throw new DatabaseUnavailable();
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new DatabaseUnavailable();
    }
    let active = true;
    let discard = false;
    let began = false;
    let driverFailed = false;
    const query = async <T>(sql: string, parameters?: unknown[]) => {
      if (!active) throw new Error("Transaction has ended");
      try {
        const result = await client.query<QueryResultRow>(sql, parameters);
        return { rows: result.rows as T[] };
      } catch {
        driverFailed = true;
        discard = true;
        throw new DatabaseUnavailable();
      }
    };
    const transaction: DatabaseTransaction = {
      query,
      exec: async (sql) => { await query(sql); },
    };
    try {
      await query("BEGIN");
      began = true;
      const result = await work(transaction);
      // A callback must not swallow a driver failure and commit partial work.
      if (driverFailed) throw new DatabaseUnavailable();
      await query("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        try { await query("ROLLBACK"); }
        catch { discard = true; }
      }
      throw error;
    } finally {
      active = false;
      client.release(discard);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try { await this.pool.end(); }
    catch { throw new DatabaseUnavailable(); }
    finally { this.pool.off("error", this.onIdleError); }
  }
}
