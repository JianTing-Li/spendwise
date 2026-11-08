import assert from "node:assert/strict";
import { retrievalDemoDatabase } from "./retrieval-support";

async function main() {
const demo = await retrievalDemoDatabase();
try {
  const exception = demo.state.exceptions.find(e => e.vendorId === "vendor-renewal") ?? demo.state.exceptions.find(e => e.rule === "payment_increase")!;
  const r = demo.retrieval(exception.id);
  const summary = await r.get_payment_summary();
  const payments = await r.list_payments();
  const invoices = await r.get_invoices();
  const notes = await r.get_vendor_notes();
  const payment = payments.find(p => invoices.some(i => i.id===p.invoiceId) && notes.some(n => n.paymentIds.includes(p.id) || n.invoiceIds.includes(p.invoiceId ?? "")))!;
  assert(payment);
  const invoice = invoices.find(i => i.id===payment.invoiceId)!;
  const note = notes.find(n => n.paymentIds.includes(payment.id) || n.invoiceIds.includes(invoice.id))!;
  const outside = demo.state.dataset.payments.find(p => p.vendorId!==exception.vendorId)!;
  const denied = await r.list_payments({paymentIds:[outside.id]});
  assert.deepEqual(denied, []);
  let writeCode = "";
  try { await demo.db.transaction(async tx => {
    await tx.exec("SET LOCAL ROLE spendwise_retrieval_reader");
    await tx.exec("DELETE FROM payments");
  }); } catch (e) { writeCode = String((e as {code?: string}).code); }
  assert.equal(writeCode,"42501");
  console.log(JSON.stringify({ database: "PGlite", generation: demo.state.generation, summary,
    matching: {payment,invoice,note}, outOfScope: {requested:outside.id,returned:denied},
    readerWrite: {rejected:true,sqlstate:writeCode}, modelRequests:0 }, null, 2));
} finally { await demo.db.close(); }

}
main().catch(() => { console.error("Retrieval demo failed"); process.exitCode=1; });
