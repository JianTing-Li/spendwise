/** Loopback synthetic capability; hosted identity uses the separate application boundary below. */
export function localRequestAllowed(
  request: Request,
  hosted = Boolean(process.env.VERCEL),
): boolean {
  if (hosted || process.env.DATABASE_MODE === "neon") return false;
  if (request.headers.has("forwarded") ||
      (request.headers.has("x-forwarded-for") && !/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(request.headers.get("x-forwarded-for")!)) ||
      (request.headers.has("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== "http")) return false;
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

import { permits, type Permission, type Principal } from './access-policy';
export { permits } from './access-policy';
export type { Principal } from './access-policy';
const localGrant: Principal = { subject: 'local:loopback', grant: { permissions: ['read', 'inject', 'reset', 'review', 'retry'] } };
/** Signed-out hosted visitor under SPENDWISE_PUBLIC_READ. Never a grant key: grants only accept github:<id>. */
export const PUBLIC_SUBJECT = 'public:anonymous';
const publicRead = () => process.env.SPENDWISE_PUBLIC_READ === '1'; // Exact match; any other value keeps sign-in required.
export type Access = { principal: Principal; denied?: never } | { principal?: never; denied: Response };
export function deny(status: 401 | 403) {
  return Response.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status, headers: { 'Cache-Control': 'no-store' } });
}
/** Trusted loopback development: no hosting, Neon or hosted Auth.js settings. */
const localMode = () => !process.env.VERCEL && process.env.DATABASE_MODE !== 'neon' && !process.env.AUTH_URL;
export async function identify(request: Request): Promise<Access> {
  // Origin failures have their own 403 semantics even if no cookie is present.
  // The only cross-site request allowed is a top-level navigation to the dashboard (OAuth return,
  // portfolio links). Never an API route, iframe or subresource, so public reads stay same-site.
  if (request.headers.get('sec-fetch-site') === 'cross-site' &&
      !(request.method === 'GET' && request.headers.get('sec-fetch-mode') === 'navigate' &&
        request.headers.get('sec-fetch-dest') === 'document' && new URL(request.url).pathname === '/'))
    return { denied: deny(403) }; // Lax cookies permit top-level OAuth return navigation, never cross-site mutations.
  if (localMode()) {
    if (localRequestAllowed(request)) return { principal: localGrant };
    return { denied: deny(403) };
  }
  const { hostedConfig, sessionPrincipal } = await import('./authentication');
  const config = hostedConfig();
  if (!config) return { denied: deny(401) };
  const origin = request.headers.get('origin');
  if ((origin && origin !== config.origin) || (request.method !== 'GET' &&
    (origin !== config.origin || request.headers.get('x-spendwise-demo') !== '1')))
    return { denied: deny(403) };
  const principal = await sessionPrincipal(request);
  // Optional public viewing (decision 005): only with valid hosted auth (checked above), only
  // for GETs, and only `read`. Every mutation still needs a granted session.
  const publicGet = request.method === 'GET' && publicRead();
  if (principal) {
    // Signing in never shows less than the public view: an account without `read` gains only
    // `read`, only on GETs. Its other permissions and run scope are unchanged.
    if (publicGet && !principal.grant.permissions.includes('read'))
      return { principal: { subject: principal.subject, grant: { ...principal.grant, permissions: [...principal.grant.permissions, 'read'] } } };
    return { principal };
  }
  if (publicGet) return { principal: { subject: PUBLIC_SUBJECT, grant: { permissions: ['read'] } } };
  return { denied: deny(401) };
}
/**
 * Hosted pages served on another host (a Vercel deployment-specific URL) would render a sign-in
 * form that posts to AUTH_URL from a different origin, which the sign-in route rejects. Returns
 * the same path on the canonical origin, or null when no redirect is needed: already canonical,
 * local loopback mode, or hosted authentication not fully configured (which stays fail-closed).
 */
export async function canonicalRedirect(host: string | null, path = '/'): Promise<string | null> {
  if (localMode()) return null;
  const { hostedConfig } = await import('./authentication');
  const config = hostedConfig();
  if (!config || !host) return null;
  const canonical = new URL(config.origin);
  if (host.toLowerCase() === canonical.host) return null;
  return new URL(path.startsWith('/') && !path.startsWith('//') ? path : '/', canonical).toString();
}
export function authorize(principal: Principal, permission: Permission, runId?: string) {
  return permits(principal, permission, runId) ? null : deny(403);
}
export { boundedJson } from './request-body';
