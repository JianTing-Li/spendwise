import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Store } from "../src/server/db/store";
import { runPending } from "../src/server/investigation/run";
import { stubInvestigator } from "../src/server/investigation/stub";
import { syntheticModel } from "../tests/helpers/int01-model";

// This executable always injects a fake client. It never loads credentials/SDK.
async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === "--output-dir"));
  const output = resolve(args[1] ?? ".data/int01-demo");
  await mkdir(output, {recursive:true});
  const directory = await mkdtemp(join(tmpdir(),"int01-visible-"));
  process.env.INVESTIGATOR_MODE = "real";
  let db = new PGlite(directory);
  let store = new Store(db);
  let fakeRequests = 0;
  const fake = syntheticModel();
  const client = { create: async (...args: Parameters<typeof fake.create>) => { fakeRequests++; return fake.create(...args); } };
  const cycles = [];
  try {
    await store.initialize();
    for (let cycle=1;cycle<=3;cycle++) {
      const injection = await Promise.all([store.inject(),store.inject()]);
      assert.deepEqual(injection.map(r=>r.changed).sort(),[false,true]);
      const pending = await store.state();
      await Promise.all([runPending(store,{client}),runPending(store,{client})]);
      const completed = await store.state();
      assert.equal(completed.runs.length,4);
      assert(completed.runs.every(r=>r.state==="completed" && r.toolExecutions===3 && r.modelRequests===2));
      await store.review(completed.runs[0].id);
      await db.close(); db = new PGlite(directory); store = new Store(db); await store.initialize();
      const reopened = await store.state();
      assert(reopened.runs[0].reviewedAt);
      cycles.push({cycle,pending:pending.runs.map(r=>r.state),...reopened});
      await store.reset();
      assert.equal((await store.state()).runs.length,0);
    }
    await store.inject();
    let waiting=0; let started!:()=>void;
    const ready = new Promise<void>(r=>{started=r;});
    const controller = new AbortController();
    const task = runPending(store,{signal:controller.signal,client:{create:async (_params,options)=>{
      if (++waiting===4) started();
      return new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("cancelled")),{once:true}));
    }}});
    await ready;
    const running = await store.state();
    assert(running.runs.every(r=>r.state==="running" && r.modelRequests===1));
    controller.abort(); await task;
    const cancelled = await store.state();
    assert(cancelled.runs.every(r=>r.state==="cancelled"));
    const predecessor = cancelled.runs[0].id;
    const retries = await Promise.all([store.retry(predecessor),store.retry(predecessor)]);
    assert.deepEqual(retries.map(r=>r.changed).sort(),[false,true]);
    await runPending(store,{client});
    const retried = await store.state();
    assert.equal(retried.runs.length,5);
    await store.reset(); await store.inject();
    const stale = (await store.state()).runs[0];
    const input = (await store.claim(stale.id))!;
    await store.reset(); await store.inject();
    const staleSaved = await store.finish(stale.id,input.generation,await stubInvestigator.investigate(input,new AbortController().signal));
    assert.equal(staleSaved,false);
    const report = { version:"int01-offline-v1", data:"synthetic only", paidModelRequests:0,
      fakeRequests:fakeRequests+waiting, completedCycles:cycles.length, cycles,
      running:running.runs,cancelled:cancelled.runs,retried:retried.runs,staleSaved,
      notes:["Real investigator loop, fake model client, scoped database tools.",
        "Completed means valid references, not a verified business cause.",
        "Counters reserve attempts before dispatch; interrupted batches may conservatively overcount.",
        "Hosted OAuth/Neon and paid model reliability are not tested by this demo."] };
    await writeFile(join(output,"investigation-demo.json"),JSON.stringify(report,null,2));
    const escape = (text: unknown) => String(text).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    const rows = cycles[0].runs.map(r=>`<tr><td>${escape(r.exceptionId)}</td><td>${escape(r.state)}</td><td>${r.toolExecutions} / 8</td><td>${r.modelRequests} / 10</td><td>${escape(r.findings[0]?.referenceStatus)}</td><td>${escape(r.findings[0]?.supportStatus)}</td></tr>`).join("");
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SpendWise INT-01 offline demo</title><style>body{font:16px system-ui;max-width:1100px;margin:48px auto;padding:0 24px;background:#f4f7fa;color:#172c39}h1{font-size:34px}section{background:white;padding:24px;border-radius:12px;margin:20px 0}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:12px;border-bottom:1px solid #dce4eb;font-size:14px}strong{color:#166346}code{overflow-wrap:anywhere}.badge{display:inline-block;background:#d9f3e8;padding:7px 14px;border-radius:20px}li{margin:10px 0}</style><h1>SpendWise · durable investigations</h1><p>Reproducible offline evidence · synthetic financial records · fake model</p><section><span class="badge">3 complete cycles</span> <span class="badge">0 paid requests</span><p>Inject → scoped retrieval → validate → persist → reopen → human review → reset</p><table><thead><tr><th>Exception</th><th>Run</th><th>Retrievals</th><th>Requests</th><th>References</th><th>Support</th></tr></thead><tbody>${rows}</tbody></table><p>Every displayed outcome comes from this execution. A completed run does not establish a verified business cause.</p></section><section><h2>Recovery checks</h2><ul><li>Four model waits started concurrently; each stored its request counter before waiting.</li><li>Request cancellation persisted four cancelled attempts.</li><li>Double-click retry created one successor; five history records remain.</li><li>Reset rejected the old generation result: saved = <strong>${staleSaved}</strong>.</li><li>Closing and reopening the local database preserved findings and human review.</li></ul></section><section><h2>Try it yourself</h2><p><code>node --conditions=react-server --import tsx scripts/investigation-demo.ts</code></p><p>Open .data/int01-demo/investigation-demo.html. Full records: investigation-demo.json.</p><h2>Teach-back challenge</h2><p>Why must the generation check and result write share a transaction? Predict what a reset during a model wait should do, then run the integration test and explain why the late result cannot return.</p><p>${report.notes.map(escape).join("<br>")}</p></section></html>`;
    await writeFile(join(output,"investigation-demo.html"),html);
    console.log(JSON.stringify({completedCycles:cycles.length,durableRuns:12,requestCancellation:"passed",retryIdempotency:"passed",staleSaved,paidModelRequests:0,output}));
  } finally { await db.close(); await rm(directory,{recursive:true,force:true}); }
}
main().catch(()=>{console.error("Offline investigation demo failed; no driver details emitted");process.exitCode=1;});
