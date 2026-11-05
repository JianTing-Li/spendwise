// Explicit local-only settings, independent of application DATABASE_URL.
// PG_TEST_ALLOW_LOCAL=1 is required; never accepts a Neon/remote endpoint.
export function localConnection(env: Readonly<Record<string, string | undefined>>) {
  if (env.PG_TEST_ALLOW_LOCAL !== "1") throw new Error("Set PG_TEST_ALLOW_LOCAL=1 for local PostgreSQL integration tests");
  const host = env.PG_TEST_HOST || "/tmp";
  if (!["/tmp", "/var/run/postgresql", "localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error("Integration PostgreSQL must use a local socket or loopback host");
  const port = Number(env.PG_TEST_PORT || "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local test port");
  const database = env.PG_TEST_DATABASE;
  const user = env.PG_TEST_USER;
  if (!database || !/^[a-zA-Z0-9_]+_test$/.test(database) || !user)
    throw new Error("Specify PG_TEST_DATABASE ending in _test and PG_TEST_USER");
  return { host, port, database, user, password: env.PG_TEST_PASSWORD, ssl: false };
}
