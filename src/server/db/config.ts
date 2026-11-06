import type { PoolConfig } from "pg";
export type DatabaseMode = "local" | "postgres" | "neon";
export function databaseConfig(env: Readonly<Record<string, string | undefined>> = process.env, purpose: "application" | "migration" = "application") {
  const mode = env.DATABASE_MODE ?? "local";
  if (!["local", "postgres", "neon"].includes(mode))
    throw new Error("Invalid database mode");
  if (mode === "local") {
    if (env.VERCEL)
      throw new Error("Local database unavailable on hosted runtime");
    return { mode: "local" as const };
  }
  const migrationRole = env.DATABASE_MIGRATION_ROLE;
  if (!migrationRole || !/^[a-z_][a-z0-9_]{0,62}$/.test(migrationRole))
    throw new Error("Migration role required");
  // Application runtime requires no migration credential. CLI alone reads it.
  const names = purpose === "migration" ? ["DATABASE_URL", "DATABASE_READONLY_URL", "DATABASE_MIGRATION_URL"] : ["DATABASE_URL", "DATABASE_READONLY_URL"];
  const urls = names.map(name => {
    try {
      const url = new URL(env[name] ?? "");
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.pathname.slice(1))
        throw 0;
      // No libpq/URL SSL switches may override our verified TLS policy.
      if ([...url.searchParams.keys()].some(k => /^(ssl|options|host|user|password|database|port)/i.test(k)))
        throw 0;
      if (url.hash)
        throw 0;
      return url;
    }
    catch {
      throw new Error("Invalid database configuration");
    }
  });
  if (new Set([...urls.slice(0, 2).map(u => decodeURIComponent(u.username)), migrationRole]).size !== 3 || (purpose === "migration" && decodeURIComponent(urls[2].username) !== migrationRole))
    throw new Error("Separate database logins required");
  if (new Set(urls.map(u => u.pathname)).size !== 1)
    throw new Error("Database targets must match");
  if (mode === "postgres" && new Set(urls.map(u => u.hostname + ":" + (u.port || "5432"))).size !== 1)
    throw new Error("Database endpoints must match");
  if (mode === "postgres" && urls.some(u => !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    throw new Error("Postgres mode requires loopback");
  if (mode === "neon") {
    if (urls.some(u => !u.hostname.endsWith(".neon.tech")))
      throw new Error("Neon host required");
    if (!urls[0].hostname.split(".")[0].endsWith("-pooler"))
      throw new Error("Pooled Neon application URL required");
    const endpoint = (u: URL) => u.hostname.replace(/-pooler\./, ".");
    if (new Set(urls.map(endpoint)).size !== 1)
      throw new Error("Database endpoints must match");
  }
  const connection = (url: URL): PoolConfig => ({ connectionString: url.toString(), ssl: mode === "neon" ? { rejectUnauthorized: true } : false });
  return { mode: mode as Exclude<DatabaseMode, "local">, application: connection(urls[0]), migration: purpose === "migration" ? connection(urls[2]) : undefined, readonly: connection(urls[1]) };
}
