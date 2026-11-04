/** Local demo capability. Hosted requests fail closed until real authentication exists. */
export function localRequestAllowed(
  request: Request,
  hosted = Boolean(process.env.VERCEL),
): boolean {
  if (hosted || process.env.DATABASE_MODE === "neon") return false;
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  const incoming = new URL(`${url.protocol}//${host}`);
  const allowedHost =
    url.hostname === "127.0.0.1" || url.hostname === "localhost";
  // Next.js normalizes the internal URL to localhost even for 127.0.0.1 requests.
  if (!allowedHost || incoming.port !== url.port) return false;
  // Reject proxy forwarding and cross-site requests, including DNS-rebinding origins.
  if (
    request.headers.has("x-forwarded-host") &&
    request.headers.get("x-forwarded-host") !== host
  )
    return false;
  if (request.method !== "GET")
    return (
      request.headers.get("origin") === incoming.origin &&
      request.headers.get("x-spendwise-demo") === "1" &&
      request.headers.get("content-type")?.split(";")[0] === "application/json"
    );
  return (
    !request.headers.get("origin") ||
    request.headers.get("origin") === incoming.origin
  );
}
