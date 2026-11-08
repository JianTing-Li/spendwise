import {
  ToolInputs,
  ToolOutputs,
  type Dataset,
  type Exception,
} from "../../contracts";
import type { Retrieval } from "../../investigation";
import { bounded, duplicateLookbackStart } from "./bounds";
import { periods } from "../../domain/finance";

export function fixtureRetrieval(
  data: Dataset,
  exception: Exception,
): Retrieval {
  const cutoff = duplicateLookbackStart();
  const payments = data.payments.filter(
    (p) =>
      p.vendorId === exception.vendorId &&
      p.date < periods.endExclusive &&
      (exception.paymentIds.includes(p.id) ||
        p.date >= cutoff ||
        data.payments.some(
          (q) =>
            q.vendorId === exception.vendorId &&
            q.date < periods.endExclusive &&
            exception.paymentIds.includes(q.id) && q.reversalReference === p.id,
        )),
  );
  const paymentIds = new Set(payments.map((p) => p.id));
  const invoiceIds = new Set(payments.map((p) => p.invoiceId));
  const invoices = data.invoices.filter(
    (i) => i.vendorId === exception.vendorId && invoiceIds.has(i.id),
  );
  const notes = data.notes.filter(
    (n) =>
      n.vendorId === exception.vendorId &&
      n.date < periods.endExclusive &&
      (n.paymentIds.some((id) => paymentIds.has(id)) ||
        n.invoiceIds.some((id) => invoiceIds.has(id))),
  );
  return {
    async get_payment_summary() {
      return ToolOutputs.get_payment_summary.parse(exception.summary);
    },
    async list_payments(input = {}) {
      const { paymentIds: ids } = ToolInputs.list_payments.parse(input);
      return ToolOutputs.list_payments.parse(
        bounded(payments.filter((p) => !ids || ids.includes(p.id))),
      );
    },
    async get_invoices(input = {}) {
      const { invoiceIds: ids } = ToolInputs.get_invoices.parse(input);
      return ToolOutputs.get_invoices.parse(
        bounded(invoices.filter((i) => !ids || ids.includes(i.id))),
      );
    },
    async get_vendor_notes(input = {}) {
      const { noteIds: ids } = ToolInputs.get_vendor_notes.parse(input);
      return ToolOutputs.get_vendor_notes.parse(
        bounded(notes.filter((n) => !ids || ids.includes(n.id)).map(n => ({ ...n, paymentIds: n.paymentIds.filter(id => paymentIds.has(id)), invoiceIds: n.invoiceIds.filter(id => invoiceIds.has(id)) }))),
      );
    },
  };
}
