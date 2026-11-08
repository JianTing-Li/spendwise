import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { store, runPending } = vi.hoisted(() => ({ store: { state: vi.fn(), inject: vi.fn(), reset: vi.fn(), review: vi.fn(), retry: vi.fn() }, runPending: vi.fn() }));
vi.mock('../src/server/db/local', () => ({ getStore: async () => store }));
vi.mock('../src/server/investigation/run', () => ({ runPending }));
import { encode } from 'next-auth/jwt';
import { GET, POST } from '../src/app/api/demo/route';
import { POST as retry } from '../src/app/api/demo/retry/route';
import { authenticationRoute, hostedConfig } from '../src/server/authentication';
import { boundedJson, identify, permitsResource } from '../src/server/access';
const origin = 'https://demo.example';
const secret = 'offline-only-not-a-real-secret-1234567890';
const salt = '__Secure-authjs.session-token';
const grants = { 'github:123': { permissions: ['read', 'inject', 'reset', 'review', 'retry'] } };
function req(body?: unknown, cookie = '', extra: Record<string,string> = {}) {
  return new Request(`${origin}/api/demo`, { method: body === undefined ? 'GET' : 'POST', headers: { host: 'demo.example', origin, cookie, 'x-spendwise-demo': '1', 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function cookie(sub = 'github:123', maxAge = 3600) {
  return `${salt}=${await encode({ token: { sub }, secret, salt, maxAge })}`;
}
beforeEach(() => {
  vi.stubEnv('VERCEL', '1'); vi.stubEnv('AUTH_URL', origin); vi.stubEnv('AUTH_SECRET', secret);
  vi.stubEnv('AUTH_GITHUB_ID', 'offline-id'); vi.stubEnv('AUTH_GITHUB_SECRET', 'offline-provider-secret');
  vi.stubEnv('SPENDWISE_ACCESS_GRANTS', JSON.stringify(grants));
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
it('redacts dependency errors and checks future retrieval subject, IDs and generation', async () => {
  store.state.mockRejectedValue(new Error(secret));
  const response = await GET(req(undefined,await cookie())); expect(response.status).toBe(503); expect(await response.text()).toBe('{"error":"unavailable"}');
  const p = {subject:'github:123',grant:{permissions:['read' as const]}};
  const scope = {subject:p.subject,generation:2,resourceIds:['p1']};
  expect(permitsResource(p,scope,'p1',2)).toBe(true);
  expect(permitsResource(p,scope,'p2',2)).toBe(false); expect(permitsResource(p,scope,'p1',3)).toBe(false);
  expect(permitsResource(p,{...scope,subject:'github:999'},'p1',2)).toBe(false);
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
