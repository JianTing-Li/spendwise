/** Internal persistence boundary; public application contracts remain unchanged. */
export interface DatabaseTransaction {
  query<T>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
  /** Application-owned SQL only, for migrations and fixed multi-statement work. */
  exec(sql: string): Promise<unknown>;
}

export interface Database {
  readonly dialect?: "postgres";
  transaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
