import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { userInfo } from "node:os";
import { Pool } from "pg";
import { PgDatabase } from "../src/server/db/pg";
import { Store } from "../src/server/db/store";
import { databaseRetrieval } from "../src/server/retrieval/database";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";

// Creates/drops only a fixed disposable database and three test roles on an
// explicitly opted-in local test server. No environment/application URLs accepted.
async function main() {
  assert.equal(process.env.APP03_ALLOW_LOCAL_PG,"1");
  const port = Number(process.env.APP03_PG_PORT ?? "55439");
  assert(Number.isInteger(port) && port>1024 && port<65536);
  const adminConfig = { host:"/tmp",port,user:userInfo().username,database:"postgres",ssl:false };
  const admin = new Pool(adminConfig);
  const password = randomBytes(24).toString("hex");
  let owner: PgDatabase | undefined;
  let application: PgDatabase | undefined;
  let reader: PgDatabase | undefined;
  let created = false;
  const createdRoles: string[] = [];
  try {
    const version = (await admin.query("SHOW server_version_num")).rows[0].server_version_num;
    assert(Number(version)>=170000 && Number(version)<180000);
    // Existing names abort; this command never drops an existing database.
    await admin.query("CREATE DATABASE app03_retrieval_test");
    created = true;
    for (const name of ["app03_owner", "app03_app", "app03_reader"]) {
      await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
      createdRoles.push(name);
    }
    owner = PgDatabase.create({...adminConfig,database:"app03_retrieval_test"});
    // Own tables as the migration role, distinct from both runtime logins.
    const ownerDb = owner;
    const migrationDb = {dialect:"postgres" as const,close:async()=>{},transaction:<T>(work: Parameters<PgDatabase["transaction"]>[0]) => ownerDb.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE app03_owner");
      return work(tx) as Promise<T>;
    })};
    await owner.transaction(async tx => {
      await tx.exec("ALTER SCHEMA public OWNER TO app03_owner; REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE TEMPORARY ON DATABASE app03_retrieval_test FROM PUBLIC;");
    });
    const store = new Store(migrationDb);
    await store.initialize();
    await store.inject();
    await owner.transaction(async tx => {
      await tx.exec(`GRANT CONNECT ON DATABASE app03_retrieval_test TO app03_app,app03_reader;
        GRANT USAGE ON SCHEMA public TO app03_app,app03_reader;
        GRANT SELECT,INSERT,UPDATE,DELETE ON demo_state,vendors,invoices,payments,vendor_notes,note_payments,note_invoices,exceptions,investigation_runs TO app03_app;
        GRANT SELECT ON schema_migrations TO app03_app;
        GRANT SELECT ON vendors,invoices,payments,vendor_notes,note_payments,note_invoices TO app03_reader;`);
    });
    // TCP connections require SCRAM passwords, rather than socket trust.
    const config = {host:"127.0.0.1",port,database:"app03_retrieval_test",password,ssl:false};
    application = PgDatabase.create({...config,user:"app03_app"});
    reader = PgDatabase.create({...config,user:"app03_reader"});
    const state = await new Store(application).state();
    for (const exception of state.exceptions) {
      const actual = databaseRetrieval({application,reader},{exceptionId:exception.id,generation:state.generation});
      const expected = fixtureRetrieval(state.dataset,exception);
      const ordered = <T extends {id:string}>(rows:T[]) => rows.sort((a,b)=>a.id.localeCompare(b.id));
      assert.deepEqual(await actual.get_payment_summary(),await expected.get_payment_summary());
      assert.deepEqual(ordered(await actual.list_payments()),ordered(await expected.list_payments()));
      assert.deepEqual(ordered(await actual.get_invoices()),ordered(await expected.get_invoices()));
      assert.deepEqual(ordered(await actual.get_vendor_notes()),ordered(await expected.get_vendor_notes()));
    }
    const exception = state.exceptions.find(e => e.vendorId==="vendor-renewal")!;
    const r = databaseRetrieval({application,reader},{exceptionId:exception.id,generation:state.generation});
    const foreign = state.dataset.payments.find(p=>p.vendorId!==exception.vendorId)!;
    assert.deepEqual(await r.list_payments({paymentIds:[foreign.id]}),[]);
    const denied = [];
    for (const [kind,sql] of [
      ["INSERT","INSERT INTO vendors VALUES ('forbidden','{}')"],
      ["UPDATE","UPDATE payments SET payload=payload"],
      ["DELETE","DELETE FROM payments"],
      ["DDL","CREATE TABLE forbidden (id int)"],
      ["TEMP_DDL","CREATE TEMP TABLE forbidden (id int)"],
      ["STATE","SELECT * FROM demo_state"],
      ["ESCALATION","SET ROLE app03_owner"],
    ]) {
      await assert.rejects(reader.transaction(tx=>tx.exec(sql)), e=> (e as {sqlstate?:string}).sqlstate==="42501");
      denied.push(kind);
    }
    const result = {database:"PostgreSQL 17",separatePasswordLogins:true,fixtureParity:{exceptions:state.exceptions.length,methods:4},
      legitimate:{summary:await r.get_payment_summary(),payments:await r.list_payments(),invoices:await r.get_invoices(),notes:await r.get_vendor_notes()},
      outOfScope:{requested:foreign.id,returned:[]},readerDenied:denied,sqlstate:"42501",modelRequests:0};
    let releaseRead!: () => void;
    let enterRead!: () => void;
    const entered = new Promise<void>(resolve => { enterRead=resolve; });
    const released = new Promise<void>(resolve => { releaseRead=resolve; });
    const actualReader = reader;
    const pausedReader = {dialect:"postgres" as const,close:async()=>{},transaction:<T>(work: Parameters<PgDatabase["transaction"]>[0]) => actualReader.transaction(async tx => {
      enterRead(); await released; return work(tx) as Promise<T>;
    })};
    const racing = databaseRetrieval({application,reader:pausedReader},{exceptionId:exception.id,generation:state.generation});
    const lookup = racing.list_payments();
    await entered;
    let resetFinished=false;
    const reset = new Store(application).reset().then(()=>{resetFinished=true;});
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(resetFinished,false);
    releaseRead();
    assert((await lookup).length>0);
    await reset;
    Object.assign(result,{generationRace:"reset waited for evidence read"});
    await assert.rejects(r.list_payments(),e=>(e as {code?:string}).code==="stale_generation");
    // Printed only after cleanup succeeds below.
    return result;
  } finally {
    await reader?.close();
    await application?.close();
    await owner?.close();
    if (created) {
      await admin.query("DROP DATABASE app03_retrieval_test");
      for (const name of createdRoles.reverse())
        await admin.query(`DROP ROLE IF EXISTS ${name}`);
    }
    await admin.end();
  }
}
main().then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{
  console.error("Local PostgreSQL retrieval verification failed; no driver details emitted");process.exitCode=1;
});
