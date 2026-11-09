// Fixed reasons thrown by startup validation. They contain no URLs, credentials or driver text.
const safeReasons = new Set([
  "Investigator mode unavailable",
  "Invalid database mode",
  "Local database unavailable on hosted runtime",
  "Migration role required",
  "Invalid database configuration",
  "Separate database logins required",
  "Database targets must match",
  "Database endpoints must match",
  "Postgres mode requires loopback",
  "Neon host required",
  "Pooled Neon application URL required",
  "Database limits must be positive safe integers",
  "Database startup options unavailable",
  "Invalid database URL",
  "Database URL timeout overrides unavailable",
  "Read-only database permissions required",
  "Application database permissions required",
  "Database migration required",
]);

/** Logs only the error class, SQLSTATE and allowlisted reason; never messages from drivers. */
export function logDemoUnavailable(error: unknown) {
  const { sqlstate } = (error ?? {}) as { sqlstate?: unknown };
  const message = error instanceof Error ? error.message : "";
  console.error({
    name: "DemoUnavailable",
    errorClass: error instanceof Error ? error.constructor.name : "NonError",
    ...(typeof sqlstate === "string" && /^[0-9A-Z]{5}$/.test(sqlstate) ? { code: sqlstate } : {}),
    ...(safeReasons.has(message) ? { reason: message } : {}),
  });
}
