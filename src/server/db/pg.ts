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
  constructor(readonly outcomeUnknown = false) {
    super("Database unavailable");
    this.name = "DatabaseUnavailable";
  }
}
export class DatabaseConflict extends Error {
  constructor(readonly sqlstate: string) {
    super("Database operation conflicted");
    this.name = "DatabaseConflict";
  }
}
export class DatabaseTimeout extends DatabaseConflict {
  constructor(sqlstate: string) {
    super(sqlstate);
    this.name = "DatabaseTimeout";
    this.message = "Database operation timed out";
  }
}
export class DatabaseQueryError extends Error {
  constructor(readonly sqlstate: string) {
    super("Database query failed");
    this.name = "DatabaseQueryError";
  }
}

/** Preserve a safe classification, never driver messages/SQL/credentials. */
function classify(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : "";
  if (!/^[0-9A-Z]{5}$/.test(code) || code.startsWith("08") || /^57P0[123]$/.test(code))
    return new DatabaseUnavailable();
  if (code === "55P03" || code === "57014") return new DatabaseTimeout(code);
  if (code.startsWith("40")) return new DatabaseConflict(code);
  return new DatabaseQueryError(code);
}

/** Pure configuration builder; no connection or credentials are logged. */
export function pgPoolOptions(
  connection: PoolConfig,
  limits: Partial<PgLimits> = {},
): PoolConfig {
  const bounded = { ...pgTestDefaults, ...limits };
  for (const value of Object.values(bounded))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Database limits must be positive safe integers");
  if (connection.options || process.env.PGOPTIONS?.trim())
    throw new Error("Database startup options unavailable");
  if (connection.connectionString) {
    let url: URL;
    try { url = new URL(connection.connectionString); }
    catch { throw new Error("Invalid database URL"); }
    for (const name of url.searchParams.keys())
      if (/^(options|connect_timeout|connectionTimeoutMillis|statement_timeout|lock_timeout|idle_in_transaction_session_timeout)$/i.test(name))
        throw new Error("Database URL timeout overrides unavailable");
  }
  // pg's option lookup uses `config.options || process.env.PGOPTIONS`.
  // Truthy whitespace blocks later environment overrides for newly opened clients.
  return { ...connection, ...bounded, options: " " };
}

export class PgDatabase implements Database {
  private closed = false;
  // pg-pool already removes a failed idle client. Handle the event without
  // poisoning healthy clients or permanently disabling the pool. Never replay work.
  private readonly onIdleError = () => {};

  constructor(private readonly pool: Pool) {
    pool.on("error", this.onIdleError);
  }

  static create(connection: PoolConfig, limits?: Partial<PgLimits>) {
    return new PgDatabase(new Pool(pgPoolOptions(connection, limits)));
  }

  async transaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    if (this.closed) throw new DatabaseUnavailable();
    let client: PoolClient;
    try { client = await this.pool.connect(); }
    catch { throw new DatabaseUnavailable(); }
    let active = true;
    let discard = false;
    let began = false;
    let driverFailure: Error | undefined;
    const onClientError = () => {
      discard = true;
      driverFailure = new DatabaseUnavailable();
    };
    client.on("error", onClientError);
    const query = async <T>(sql: string, parameters?: unknown[]) => {
      if (!active) throw new Error("Transaction has ended");
      try {
        const result = await client.query<QueryResultRow>(sql, parameters);
        return { rows: result.rows as T[] };
      } catch (error) {
        const mapped = classify(error);
        driverFailure ??= mapped;
        if (mapped instanceof DatabaseUnavailable) discard = true;
        throw mapped;
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
      if (driverFailure) throw driverFailure;
      try { await query("COMMIT"); }
      catch (error) {
        if (error instanceof DatabaseUnavailable) throw new DatabaseUnavailable(true);
        throw error;
      }
      return result;
    } catch (error) {
      if (began) {
        try { await query("ROLLBACK"); }
        catch {
          discard = true;
          if (!(error instanceof DatabaseUnavailable)) throw new DatabaseUnavailable();
        }
      }
      throw error;
    } finally {
      active = false;
      client.off("error", onClientError);
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
