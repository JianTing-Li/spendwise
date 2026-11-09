/** Run after npm run build. Loopback HTTP, disposable synthetic DB, zero model/provider calls. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { encode } from 'next-auth/jwt';
const secret = 'offline-demo-secret-not-for-hosting-123456789';
const salt = '__Secure-authjs.session-token';
const canonical = 'https://demo.example';
const directory = await mkdtemp(join(tmpdir(),'spendwise-access-'));
async function serve(configured, check) {
  const child = spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3197'],{
    env:{...process.env,VERCEL:'',DATABASE_MODE:'local',PGLITE_DATA_DIR:directory,INVESTIGATOR_MODE:'stub',ANTHROPIC_API_KEY:'',
      AUTH_URL:canonical,AUTH_SECRET:configured ? secret : '',AUTH_GITHUB_ID:'offline-id',AUTH_GITHUB_SECRET:'offline-secret',
      SPENDWISE_ACCESS_GRANTS:JSON.stringify({'github:123':{permissions:['read','inject','reset','review','retry']},'github:456':{permissions:['read']}})},
    stdio:['ignore','pipe','pipe']});
  try {
    // Wait for this child, never probe/mutate an unrelated process already using the port.
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Local server startup timeout')),30000);
      child.stdout.on('data',chunk=>{ if(String(chunk).includes('Ready')) { clearTimeout(timer); resolve(); } });
      child.once('exit',()=>{ clearTimeout(timer); reject(new Error('Local server stopped')); });
      child.once('error',()=>{ clearTimeout(timer); reject(new Error('Local server failed')); });
    });
    await check();
  } finally { if(child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child,'exit'); } }
}
async function cookie(sub) { return `${salt}=${await encode({token:{sub,signedInAt:Math.floor(Date.now()/1000)},salt,secret,maxAge:3600})}`; }
async function api(body, cookie='', origin=canonical) {
  return fetch('http://127.0.0.1:3197/api/demo',{method:body ? 'POST':'GET',headers:{cookie,origin,'content-type':'application/json','x-spendwise-demo':'1'},...(body ? {body:JSON.stringify(body)}:{})});
}
try {
  await serve(true,async()=>{
    assert.equal((await api()).status,401);
    assert.equal((await api({action:'reset'},await cookie('github:456'))).status,403);
    const admin=await cookie('github:123');
    assert.equal((await api({action:'reset'},admin)).status,200);
    assert.equal((await api({action:'inject',scenarioId:'demo-v1'},admin)).status,200);
    const state=await api(undefined,admin); assert.equal(state.status,200);
    const data=await state.json(); assert.equal(data.exceptions.length,4); assert(data.runs.every(r=>r.mode==='stub'));
    assert.equal((await api({action:'reset'},admin,'https://foreign.example')).status,403);
    const page=await fetch('http://127.0.0.1:3197/'); assert((await page.text()).includes('SpendWise access required'));
    console.log('HTTP: missing identity 401; denied permission 403; authorized reset/inject/read 200; cross-origin 403; protected dashboard; model calls 0');
  });
  await serve(false,async()=>{
    assert.equal((await api()).status,401);
    console.log('HTTP: missing hosted configuration fails closed 401');
  });
} finally { await rm(directory,{recursive:true,force:true}); }
