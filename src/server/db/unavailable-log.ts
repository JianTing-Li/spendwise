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

/** Logs only the error name, codes and allowlisted reason; never messages from drivers. */
export function logDemoUnavailable(error: unknown) {
  const { sqlstate, driverCode } = (error ?? {}) as { sqlstate?: unknown; driverCode?: unknown };
  const message = error instanceof Error ? error.message : "";
  // Production builds minify class names, so use the name each error class sets.
  const errorClass = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : error instanceof Error ? "Error" : "NonError";
  console.error({
    name: "DemoUnavailable",
    errorClass,
    ...(typeof sqlstate === "string" && /^[0-9A-Z]{5}$/.test(sqlstate) ? { code: sqlstate } : {}),
    ...(typeof driverCode === "string" && /^[A-Z0-9_]{2,40}$/.test(driverCode) ? { driverCode } : {}),
    ...(safeReasons.has(message) ? { reason: message } : {}),
  });
}
