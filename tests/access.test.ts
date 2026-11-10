import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { store, runPending } = vi.hoisted(() => ({ store: { state: vi.fn(), inject: vi.fn(), reset: vi.fn(), review: vi.fn(), retry: vi.fn() }, runPending: vi.fn() }));
vi.mock('../src/server/db/local', () => ({ getStore: async () => store }));
vi.mock('../src/server/investigation/run', () => ({ runPending }));
import { encode } from 'next-auth/jwt';
import { GET, POST } from '../src/app/api/demo/route';
import { POST as retry } from '../src/app/api/demo/retry/route';
import { authenticationRoute, hostedConfig } from '../src/server/authentication';
import { boundedJson, identify } from '../src/server/access';
const origin = 'https://demo.example';
const secret = 'offline-only-not-a-real-secret-1234567890';
const salt = '__Secure-authjs.session-token';
const grants = { 'github:123': { permissions: ['read', 'inject', 'reset', 'review', 'retry'] } };
function req(body?: unknown, cookie = '', extra: Record<string,string> = {}) {
  return new Request(`${origin}/api/demo`, { method: body === undefined ? 'GET' : 'POST', headers: { host: 'demo.example', origin, cookie, 'x-spendwise-demo': '1', 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function cookie(sub = 'github:123', maxAge = 3600, signedInAt = Math.floor(Date.now() / 1000)) {
  return `${salt}=${await encode({ token: { sub, signedInAt }, secret, salt, maxAge })}`;
}
beforeEach(() => {
  vi.stubEnv('VERCEL', '1'); vi.stubEnv('AUTH_URL', origin); vi.stubEnv('AUTH_SECRET', secret);
  vi.stubEnv('AUTH_GITHUB_ID', 'offline-id'); vi.stubEnv('AUTH_GITHUB_SECRET', 'offline-provider-secret');
  vi.stubEnv('SPENDWISE_ACCESS_GRANTS', JSON.stringify(grants));
  vi.stubEnv('SPENDWISE_PUBLIC_READ', ''); // Off unless a test turns it on, whatever the shell exports.
  store.state.mockResolvedValue({ synthetic: true });
  for (const action of ['inject','reset','review','retry'] as const) store[action].mockResolvedValue({ generation: 1, changed: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('denies missing, forged, tampered, expired and wrong-secret cookies before database access', async () => {
  const valid = await cookie();
  const wrong = `${salt}=${await encode({ token: { sub:'github:123' }, secret:'wrong-secret', salt })}`;
  for (const c of ['', `${salt}=forged`, valid.slice(0,-10)+'xxxxxxxxxx', await cookie('github:123', -120), wrong]) {
    expect((await GET(req(undefined,c))).status).toBe(401);
    expect((await POST(req({action:'inject',scenarioId:'demo-v1'},c))).status).toBe(401);
    expect((await retry(req({predecessorId:'r'},c))).status).toBe(401);
  }
  expect(store.state).not.toHaveBeenCalled(); expect(store.inject).not.toHaveBeenCalled(); expect(store.retry).not.toHaveBeenCalled();
});
it('enforces an absolute one-hour sign-in lifetime despite session refresh', async () => {
  const now = Math.floor(Date.now() / 1000);
  const withinHour = await cookie('github:123', 3600, now - 59 * 60);
  const refresh = await authenticationRoute(new Request(`${origin}/api/auth/session`, {
    headers: { cookie: withinHour },
  }));
  expect(refresh.status).toBe(200);
  expect((await refresh.json()).user?.id).toBe('github:123');
  const refreshed = refresh.headers.getSetCookie()
    .map(value => value.split(';')[0])
    .find(value => value.startsWith(`${salt}=`)) ?? withinHour;
  // A freshly encoded cookie cannot override the original sign-in timestamp.
  expect((await GET(req(undefined, await cookie('github:123', 3600, now - 61 * 60)))).status).toBe(401);
  // The real rotated cookie must also stop working once the absolute hour passes.
  vi.setSystemTime(new Date((now + 61) * 1000));
  try {
    expect((await GET(req(undefined, refreshed))).status).toBe(401);
  } finally {
    vi.useRealTimers();
  }
  expect(store.state).not.toHaveBeenCalled();
});
it('fails closed for legacy session cookies without a sign-in timestamp', async () => {
  const legacy = `${salt}=${await encode({ token: { sub: 'github:123' }, secret, salt, maxAge: 3600 })}`;
  expect((await GET(req(undefined, legacy))).status).toBe(401);
  expect(store.state).not.toHaveBeenCalled();
});
it('allows all explicitly granted operations using real Auth.js encrypted session verification', async () => {
  const c = await cookie();
  expect((await GET(req(undefined,c))).status).toBe(200);
  for (const body of [{action:'inject',scenarioId:'demo-v1'}, {action:'reset'}, {action:'review',runId:'r'}]) expect((await POST(req(body,c))).status).toBe(200);
  expect((await retry(req({predecessorId:'r'},c))).status).toBe(200);
  expect(store.review).toHaveBeenCalledWith('r'); expect(store.retry).toHaveBeenCalled();
});
it('rejects authenticated missing permissions, revoked subjects and exact run scope before storage', async () => {
  const c = await cookie();
  vi.stubEnv('SPENDWISE_ACCESS_GRANTS', JSON.stringify({'github:123':{permissions:['review','retry'],runIds:['allowed']}}));
  expect((await GET(req(undefined,c))).status).toBe(403);
  expect((await POST(req({action:'inject',scenarioId:'demo-v1'},c))).status).toBe(403);
  expect((await POST(req({action:'reset'},c))).status).toBe(403);
  expect((await POST(req({action:'review',runId:'other'},c))).status).toBe(403);
  expect((await retry(req({predecessorId:'other'},c))).status).toBe(403);
  expect((await POST(req({action:'review',runId:'allowed'},c))).status).toBe(200);
  expect((await GET(req(undefined,await cookie('github:999')))).status).toBe(403);
  vi.stubEnv('SPENDWISE_ACCESS_GRANTS', JSON.stringify({'github:456':{permissions:['read']}}));
  expect((await GET(req(undefined,c))).status).toBe(403);
  expect(store.inject).not.toHaveBeenCalled(); expect(store.retry).not.toHaveBeenCalled();
});
it('rejects cross-origin and missing CSRF capability, including direct API bypass', async () => {
  const c = await cookie();
  for (const extra of [{origin:'https://evil.example'}, {origin:''}, {'x-spendwise-demo':''}, {'sec-fetch-site':'cross-site'}] as Record<string,string>[])
    expect((await POST(req({action:'reset'},c,extra))).status).toBe(403);
  expect((await GET(req(undefined,c,{origin:'https://evil.example'}))).status).toBe(403);
  expect(store.reset).not.toHaveBeenCalled();
  // A top-level GET after OAuth may retain cross-site navigation metadata.
  expect((await identify(req(undefined,c,{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate'}))).principal?.subject).toBe('github:123');
});
it('fails closed for missing/invalid config with redacted responses and no provider calls', async () => {
  for (const [key,value] of [['AUTH_SECRET',''],['AUTH_URL',''],['AUTH_URL','http://demo.example'],['AUTH_GITHUB_ID',''],['AUTH_GITHUB_SECRET',''],['SPENDWISE_ACCESS_GRANTS','{invalid']]) {
    const old = process.env[key]; vi.stubEnv(key,value);
    expect(hostedConfig()).toBeNull();
    const response = await GET(req()); expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":"unauthorized"}');
    vi.stubEnv(key,old);
  }
  expect(store.state).not.toHaveBeenCalled();
});
it('bounds byte streams, content types, declared sizes and invalid input before storage', async () => {
  const c = await cookie();
  for (const [body,extra] of [[{action:'inject',extra:'x'.repeat(3000)},{}],[{action:'inject',scenarioId:'demo-v1'},{'content-length':'3000'}],[{action:'inject',scenarioId:'demo-v1'},{'content-type':'text/plain'}],[{action:'unknown'},{}]] as const)
    expect((await POST(req(body,c,extra))).status).toBe(400);
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(2049)); }, cancel() { cancelled = true; } });
  await expect(boundedJson(new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit))).rejects.toThrow('invalid_input');
  expect(cancelled).toBe(true); expect(store.inject).not.toHaveBeenCalled();
});
it('uses Auth.js secure cookies and refuses sign-in/sign-out without CSRF; strips secrets', async () => {
  const csrf = await authenticationRoute(new Request(`${origin}/api/auth/csrf`));
  const cookies = csrf.headers.get('set-cookie') ?? '';
  expect(cookies).toContain('HttpOnly'); expect(cookies).toContain('Secure'); expect(cookies).toContain('SameSite=Lax');
  for (const path of ['signin/github','signout']) {
    const response = await authenticationRoute(new Request(`${origin}/api/auth/${path}`,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:''}));
    expect(response.headers.get('location')).toContain('MissingCSRF');
  }
  const response = await authenticationRoute(new Request(`${origin}/api/auth/session`,{headers:{cookie:await cookie()}}));
  const text = await response.text(); expect(text).toContain('github:123'); expect(text).not.toContain(secret); expect(text).not.toContain('offline-provider-secret');
  expect((await authenticationRoute(new Request(`${origin}/api/auth/signout`,{method:'POST',headers:{origin:'https://evil.example'}}))).status).toBe(403);
});
it('redacts dependency errors', async () => {
  store.state.mockRejectedValue(new Error(secret));
  const response = await GET(req(undefined,await cookie())); expect(response.status).toBe(503); expect(await response.text()).toBe('{"error":"unavailable"}');
});
it('keeps local mode isolated from proxy hosts and hosted flags', async () => {
  vi.stubEnv('VERCEL',''); vi.stubEnv('AUTH_URL',''); vi.stubEnv('DATABASE_MODE','local');
  const local = new Request('http://localhost:3100/api/demo',{headers:{host:'localhost:3100','x-forwarded-host':'tunnel.example'}});
  expect((await identify(local)).denied?.status).toBe(403);
});
it('completes GitHub OAuth callback with offline provider responses and stable numeric identity', async () => {
  const jar = new Map<string,string>();
  function remember(response: Response) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0]; const index = pair.indexOf('=');
      jar.set(pair.slice(0,index), pair.slice(index+1));
    }
  }
  const jarCookie = () => [...jar].map(([k,v]) => `${k}=${v}`).join('; ');
  const csrf = await authenticationRoute(new Request(`${origin}/api/auth/csrf`)); remember(csrf);
  const {csrfToken} = await csrf.json();
  const start = await authenticationRoute(new Request(`${origin}/api/auth/signin/github`,{method:'POST',headers:{origin,cookie:jarCookie(),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken,callbackUrl:origin})}));
  remember(start);
  const redirect = new URL(start.headers.get('location')!);
  expect(redirect.origin).toBe('https://github.com');
  expect(redirect.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/callback/github`);
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') return Response.json({access_token:'offline-oauth-token',token_type:'bearer',scope:'read:user user:email'});
    if (url === 'https://api.github.com/user') return Response.json({id:123,login:'mutable-login',name:'Offline',email:'test@example.invalid',avatar_url:null});
    throw new Error('Unexpected provider request');
  });
  vi.stubGlobal('fetch',mock);
  const state = redirect.searchParams.get('state');
  expect(state).toBeTruthy();
  const invalid = await authenticationRoute(new Request(`${origin}/api/auth/callback/github?code=offline-code&state=forged`,{headers:{cookie:jarCookie()}}));
  expect(invalid.headers.get('location')).toContain('error=');
  expect(mock).not.toHaveBeenCalled();
  const callback = await authenticationRoute(new Request(`${origin}/api/auth/callback/github?code=offline-code${state ? `&state=${encodeURIComponent(state)}` : ''}`,{headers:{cookie:jarCookie()}}));
  remember(callback);
  expect(callback.headers.get('location')).toBe(origin);
  expect(mock).toHaveBeenCalledTimes(2);
  const access = await identify(req(undefined,jarCookie()));
  expect(access.principal?.subject).toBe('github:123');
  const response = await GET(req(undefined,jarCookie())); expect(response.status).toBe(200);
  const signout = await authenticationRoute(new Request(`${origin}/api/auth/signout`,{method:'POST',headers:{origin,cookie:jarCookie(),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken})}));
  remember(signout);
  expect((await GET(req(undefined,jarCookie()))).status).toBe(401);
});
// APP-05: optional public read-only viewing (docs/decisions/005-public-read-only.md).
it('keeps signed-out requests at 401 unless SPENDWISE_PUBLIC_READ is exactly "1"', async () => {
  for (const value of [undefined, '', '0', 'true', 'TRUE', 'yes', ' 1', '1 ', '01', 'on']) {
    vi.stubEnv('SPENDWISE_PUBLIC_READ', value);
    expect((await GET(req())).status).toBe(401);
    expect((await identify(req())).denied?.status).toBe(401);
  }
  expect(store.state).not.toHaveBeenCalled();
});
it('lets a signed-out visitor read with only the read permission when public reading is on', async () => {
  vi.stubEnv('SPENDWISE_PUBLIC_READ', '1');
  const access = await identify(req());
  expect(access.principal).toEqual({ subject: 'public:anonymous', grant: { permissions: ['read'] } });
  const response = await GET(req());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  // Invalid, expired and forged cookies are signed-out visitors, never more.
  for (const c of [`${salt}=forged`, await cookie('github:123', -120)])
    expect((await identify(req(undefined, c))).principal?.grant.permissions).toEqual(['read']);
});
it('keeps every mutation behind sign-in when public reading is on', async () => {
  vi.stubEnv('SPENDWISE_PUBLIC_READ', '1');
  for (const body of [{action:'inject',scenarioId:'demo-v1'}, {action:'reset'}, {action:'review',runId:'r'}])
    expect((await POST(req(body))).status).toBe(401);
  expect((await retry(req({predecessorId:'r'}))).status).toBe(401);
  expect((await POST(req({action:'reset'}, `${salt}=forged`))).status).toBe(401);
  for (const action of ['inject','reset','review','retry'] as const) expect(store[action]).not.toHaveBeenCalled();
  expect(runPending).not.toHaveBeenCalled();
});
it('keeps cross-site and missing-CSRF requests at 403 when public reading is on', async () => {
  vi.stubEnv('SPENDWISE_PUBLIC_READ', '1');
  expect((await GET(req(undefined,'',{origin:'https://evil.example'}))).status).toBe(403);
  expect((await GET(req(undefined,'',{'sec-fetch-site':'cross-site'}))).status).toBe(403);
  for (const extra of [{origin:'https://evil.example'}, {origin:''}, {'x-spendwise-demo':''}, {'sec-fetch-site':'cross-site'}] as Record<string,string>[]) {
    expect((await POST(req({action:'reset'},'',extra))).status).toBe(403);
    expect((await retry(req({predecessorId:'r'},'',extra))).status).toBe(403);
  }
  expect(store.state).not.toHaveBeenCalled(); expect(store.reset).not.toHaveBeenCalled(); expect(store.retry).not.toHaveBeenCalled();
});
it('fails closed with public reading on when hosted authentication is not fully configured', async () => {
  vi.stubEnv('SPENDWISE_PUBLIC_READ', '1');
  for (const [key,value] of [['AUTH_SECRET',''],['AUTH_URL',''],['AUTH_URL','http://demo.example'],['AUTH_GITHUB_ID',''],['AUTH_GITHUB_SECRET',''],['SPENDWISE_ACCESS_GRANTS','{invalid'],['SPENDWISE_ACCESS_GRANTS','{}']]) {
    const old = process.env[key]; vi.stubEnv(key,value);
    expect(hostedConfig()).toBeNull();
    const response = await GET(req()); expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":"unauthorized"}');
    vi.stubEnv(key,old);
  }
  expect(store.state).not.toHaveBeenCalled();
});
it('keeps signed-in grants and gives accounts without read only the public view', async () => {
  vi.stubEnv('SPENDWISE_PUBLIC_READ', '1');
  const c = await cookie();
  expect((await identify(req(undefined,c))).principal).toEqual({ subject: 'github:123', grant: grants['github:123'] });
  expect((await POST(req({action:'reset'},c))).status).toBe(200);
  // An account with no grant sees what a signed-out visitor sees, and nothing more.
  const stranger = await cookie('github:999');
  expect((await identify(req(undefined,stranger))).principal).toEqual({ subject: 'github:999', grant: { permissions: ['read'] } });
  expect((await GET(req(undefined,stranger))).status).toBe(200);
  for (const body of [{action:'inject',scenarioId:'demo-v1'}, {action:'reset'}, {action:'review',runId:'r'}])
    expect((await POST(req(body,stranger))).status).toBe(403);
  expect((await retry(req({predecessorId:'r'},stranger))).status).toBe(403);
  expect((await identify(req({action:'reset'},stranger))).principal?.grant.permissions).toEqual([]);
  // A run-scoped grant gains read on GETs only; its permissions and scope are otherwise unchanged.
  vi.stubEnv('SPENDWISE_ACCESS_GRANTS', JSON.stringify({'github:123':{permissions:['review','retry'],runIds:['allowed']}}));
  expect((await identify(req(undefined,c))).principal?.grant).toEqual({ permissions: ['review','retry','read'], runIds: ['allowed'] });
  expect((await GET(req(undefined,c))).status).toBe(200);
  expect((await POST(req({action:'review',runId:'other'},c))).status).toBe(403);
  expect((await POST(req({action:'reset'},c))).status).toBe(403);
  expect((await POST(req({action:'review',runId:'allowed'},c))).status).toBe(200);
  expect(store.inject).not.toHaveBeenCalled(); expect(store.retry).not.toHaveBeenCalled();
});
