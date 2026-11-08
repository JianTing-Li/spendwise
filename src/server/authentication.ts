import 'server-only';
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { NextRequest } from 'next/server';
import { Grants } from './access-policy';
import { boundedText } from './request-body';

export function hostedConfig() {
  try {
    const origin = new URL(process.env.AUTH_URL ?? '');
    if (origin.protocol !== 'https:' || origin.origin !== process.env.AUTH_URL ||
        origin.username || origin.password || !process.env.AUTH_GITHUB_ID?.trim() ||
        !process.env.AUTH_GITHUB_SECRET?.trim() || (process.env.AUTH_SECRET?.length ?? 0) < 32) return null;
    const grants = Grants.parse(JSON.parse(process.env.SPENDWISE_ACCESS_GRANTS ?? ''));
    if (!Object.keys(grants).length) return null;
    return { origin: origin.origin, grants };
  } catch { return null; }
}
// Fixed canonical origin; forwarded/request headers cannot redirect OAuth or select a tenant.
function provider() {
  const config = hostedConfig();
  if (!config) return null;
  return NextAuth({
    secret: process.env.AUTH_SECRET,
    trustHost: true,
    useSecureCookies: true,
    providers: [GitHub({ checks: ['pkce', 'state'], clientId: process.env.AUTH_GITHUB_ID!, clientSecret: process.env.AUTH_GITHUB_SECRET! })],
    session: { strategy: 'jwt', maxAge: 3600 },
    // Only error type/name is logged. Never print Auth.js error messages or credentials.
    logger: { error(error) { console.error('[auth]', error.name || 'AuthError'); }, warn() {}, debug() {} },
    callbacks: {
      jwt({ token, account }) {
        const now = Math.floor(Date.now() / 1000);
        if (account) {
          token.sub = `github:${account.providerAccountId}`;
          token.signedInAt = now;
        }
        // Auth.js rotates a session cookie on GET /api/auth/session. Enforce an
        // absolute one-hour lifetime independent of the refreshed JWT expiry.
        if (typeof token.signedInAt !== 'number' || !Number.isSafeInteger(token.signedInAt) ||
            token.signedInAt > now || now - token.signedInAt >= 3600) return null;
        return token;
      },
      session({ session, token }) {
        // Return only stable identity. No OAuth credentials/profile in the session API.
        return { expires: session.expires, user: { id: token.sub ?? '' } };
      },
    },
  });
}
function canonicalRequest(request: Request, origin: string) {
  const url = new URL(request.url);
  return new NextRequest(`${origin}${url.pathname}${url.search}`, request);
}
export async function sessionPrincipal(request: Request) {
  const config = hostedConfig();
  const auth = provider();
  if (!config || !auth) return null;
  try {
    const response = await auth.handlers.GET(new NextRequest(`${config.origin}/api/auth/session`, { headers: { cookie: request.headers.get("cookie") ?? "" } }));
    if (!response.ok) return null;
    const session = await response.json() as { user?: { id?: string }; expires?: string };
    if (!session?.user?.id || !session.expires || Date.parse(session.expires) <= Date.now()) return null;
    // Authenticated but revoked/ungranted identities remain identities, with zero permissions.
    return { subject: session.user.id, grant: config.grants[session.user.id] ?? { permissions: [] } };
  } catch (error) {
    console.error('[auth:session]', error instanceof Error ? error.name : 'UnknownError');
    return null;
  }
}
export async function authenticationRoute(request: Request) {
  const config = hostedConfig();
  const auth = provider();
  if (!config || !auth) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (request.method === 'POST' && request.headers.get('origin') !== config.origin)
    return Response.json({ error: 'forbidden' }, { status: 403 });
  try {
    if (request.url.length > 8192) return Response.json({ error: "invalid_input" }, { status: 400 });
    let bounded = request;
    if (request.method === "POST") {
      try {
        const text = await boundedText(request);
        bounded = new Request(request.url, { method: "POST", headers: request.headers, body: text });
      } catch { return Response.json({ error: "invalid_input" }, { status: 400 }); }
    }
    const req = canonicalRequest(bounded, config.origin);
    return request.method === 'GET' ? await auth.handlers.GET(req) : await auth.handlers.POST(req);
  } catch (error) {
    console.error('[auth:route]', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
}
