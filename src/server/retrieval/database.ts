import "server-only";
import { z } from "zod";
import { Dataset, Exception, Id, ToolInputs, ToolOutputs, Vendor } from "../../contracts";
import { periods, summarize } from "../../domain/finance";
import type { Retrieval } from "../../investigation";
import type { Database, DatabaseTransaction } from "../db/database";
import { assertReadOnly } from "../db/permissions";
import { bounded, duplicateLookbackStart, RetrievalError, retrievalLimits } from "./bounds";

const Scope = z.object({ exceptionId: Id, generation: z.number().int().nonnegative() }).strict();
type Scope = z.infer<typeof Scope>;

// Fixed, application-owned SQL. No caller can supply table names, predicates or SQL.
const scopedPayments = `WITH scoped_payments AS (
 SELECT p.* FROM payments p WHERE p.vendor_id=$1 AND p.payment_date<$2::date
 AND (p.payment_date >= $3::date OR p.id=ANY($4::text[]) OR EXISTS (
   SELECT 1 FROM payments q WHERE q.vendor_id=$1 AND q.payment_date<$2::date
   AND q.id=ANY($4::text[]) AND q.reversal_reference=p.id)))`;

/** Server-owned capability, created only after APP-02 authorizes this run.
 * application shares the reset lock; reader is a distinct restricted login.
 * Local PGlite uses the same transaction with a fixed restricted role instead.
 * Neither database handle is returned to the investigator.
 */
export function databaseRetrieval(
  databases: { application: Database; reader?: Database },
  input: Scope,
): Retrieval {
  const parsed = Scope.safeParse(input);
  if (!parsed.success) throw new RetrievalError("invalid_scope");
  const scope = Object.freeze(parsed.data);

  async function execute<T>(work: (tx: DatabaseTransaction, exception: Exception) => Promise<T>): Promise<T> {
    try {
      return await databases.application.transaction(async (control) => {
        // Concurrent evidence reads share this lock. Reset/injection take UPDATE,
        // so generation and records stay coherent until the short read ends.
        const meta = (await control.query<{ generation: number }>(
          "SELECT generation FROM demo_state WHERE id=1 FOR SHARE")).rows[0];
        if (meta?.generation !== scope.generation) throw new RetrievalError("stale_generation");
        const row = (await control.query<{ payload: unknown }>(
          "SELECT payload FROM exceptions WHERE id=$1", [scope.exceptionId])).rows[0];
        if (!row) throw new RetrievalError("invalid_scope");
        const exception = Exception.parse(row.payload);
        if (exception.id !== scope.exceptionId || exception.paymentIds.length > 100)
          throw new RetrievalError("invalid_scope");
        const read = async (tx: DatabaseTransaction) => {
          await assertReadOnly(tx);
          return bounded(await work(tx, exception));
        };
        if (databases.reader) {
          if (databases.reader === databases.application) throw new RetrievalError("invalid_scope");
          return databases.reader.transaction(read);
        }
        // PGlite has no authenticated separate connections. Setup grants this fixed
        // NOLOGIN role; SET LOCAL lasts only until this transaction ends.
        if (databases.application.dialect === "postgres") throw new RetrievalError("invalid_scope");
        await control.exec("SET LOCAL ROLE spendwise_retrieval_reader");
        return read(control);
      });
    } catch (error) {
      if (error instanceof RetrievalError) throw error;
      // SQL, driver diagnostics, credentials and record text never escape.
      throw new RetrievalError("unavailable");
    }
  }

  async function records(tx: DatabaseTransaction, sql: string, parameters: unknown[]) {
    const rows = (await tx.query<{ payload: unknown; bytes: number }>(sql, parameters)).rows;
    if (rows.length > retrievalLimits.rows || rows.some(r => r.bytes > retrievalLimits.recordBytes))
      throw new RetrievalError("evidence_limit");
    return bounded(rows.map(r => r.payload));
  }
  const projection = "CASE WHEN octet_length(payload::text)<=$6 THEN payload ELSE NULL END AS payload, octet_length(payload::text) AS bytes";
  function parameters(exception: Exception, ids?: string[]) {
    return [exception.vendorId, periods.endExclusive, duplicateLookbackStart(), exception.paymentIds,
      ids ?? null, retrievalLimits.recordBytes];
  }
  function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
    const result = schema.safeParse(value);
    if (!result.success) throw new RetrievalError("invalid_input");
    return result.data;
  }
  return Object.freeze({
    async get_payment_summary() {
      return execute(async (tx, exception) => {
        const vendor = (await tx.query<{ payload: unknown }>("SELECT payload FROM vendors WHERE id=$1", [exception.vendorId])).rows[0];
        if (!vendor) throw new RetrievalError("unavailable");
        // Include historical originals so domain validation can verify full reversals.
        // Fail on oversized histories rather than calculating misleading partial totals.
        const payments = await records(tx, `SELECT ${projection.replaceAll("$6", "$3")} FROM payments WHERE vendor_id=$1 AND payment_date<$2::date ORDER BY id LIMIT 101`,
          [exception.vendorId, periods.endExclusive, retrievalLimits.recordBytes]);
        const invoices = await records(tx, `SELECT ${projection.replaceAll("$6", "$3")} FROM invoices WHERE vendor_id=$1 AND id IN
          (SELECT invoice_id FROM payments WHERE vendor_id=$1 AND payment_date<$2::date) ORDER BY id LIMIT 101`,
          [exception.vendorId, periods.endExclusive, retrievalLimits.recordBytes]);
        const data = Dataset.parse({ vendors: [Vendor.parse(vendor.payload)], payments, invoices, notes: [] });
        return ToolOutputs.get_payment_summary.parse(summarize(data)[0]);
      });
    },
    async list_payments(input = {}) {
      const { paymentIds } = parse(ToolInputs.list_payments, input);
      return execute(async (tx, exception) => ToolOutputs.list_payments.parse(await records(tx,
        `${scopedPayments} SELECT ${projection} FROM scoped_payments WHERE ($5::text[] IS NULL OR id=ANY($5::text[])) ORDER BY id LIMIT 101`, parameters(exception, paymentIds))));
    },
    async get_invoices(input = {}) {
      const { invoiceIds } = parse(ToolInputs.get_invoices, input);
      return execute(async (tx, exception) => ToolOutputs.get_invoices.parse(await records(tx,
        `${scopedPayments} SELECT ${projection} FROM invoices WHERE vendor_id=$1
         AND id IN (SELECT invoice_id FROM scoped_payments)
         AND ($5::text[] IS NULL OR id=ANY($5::text[])) ORDER BY id LIMIT 101`, parameters(exception, invoiceIds))));
    },
    async get_vendor_notes(input = {}) {
      const { noteIds } = parse(ToolInputs.get_vendor_notes, input);
      return execute(async (tx, exception) => {
        const rows = ToolOutputs.get_vendor_notes.parse(await records(tx,
          `${scopedPayments} SELECT ${projection} FROM vendor_notes n WHERE vendor_id=$1 AND note_date<$2::date
           AND (EXISTS (SELECT 1 FROM note_payments l JOIN scoped_payments p ON p.id=l.payment_id WHERE l.note_id=n.id)
             OR EXISTS (SELECT 1 FROM note_invoices l JOIN scoped_payments p ON p.invoice_id=l.invoice_id WHERE l.note_id=n.id))
           AND ($5::text[] IS NULL OR id=ANY($5::text[])) ORDER BY id LIMIT 101`, parameters(exception, noteIds)));
        // Link IDs are evidence too: a note cannot reveal IDs outside the capability.
        const links = (await tx.query<{ id: string; invoice_id: string | null }>(
          `${scopedPayments} SELECT id,invoice_id FROM scoped_payments ORDER BY id LIMIT 101`, parameters(exception).slice(0, 4))).rows;
        if (links.length > 100) throw new RetrievalError("evidence_limit");
        const payments = new Set(links.map(r => r.id));
        const invoices = new Set(links.map(r => r.invoice_id));
        return rows.map(n => ({ ...n, paymentIds: n.paymentIds.filter(id => payments.has(id)), invoiceIds: n.invoiceIds.filter(id => invoices.has(id)) }));
      });
    },
  });
}
