import { z } from "zod";

export const Id = z.string().min(1).max(120);
export const DateOnly = z.iso.date();
export const Cents = z.number().int().safe();
export const Vendor = z.object({
  id: Id,
  name: z.string().max(200),
  category: z.string().max(100),
});
export const Invoice = z.object({
  id: Id,
  vendorId: Id,
  number: z.string(),
  date: DateOnly,
  amountCents: Cents.nonnegative(),
  currency: z.literal("USD"),
  lineItems: z.array(z.string().max(1000)).max(20),
  servicePeriod: z.string().nullable(),
});
export const Payment = z.object({
  id: Id,
  vendorId: Id,
  invoiceId: Id.nullable(),
  date: DateOnly,
  amountCents: Cents.positive(),
  currency: z.literal("USD"),
  status: z.enum(["pending", "completed", "failed"]),
  entryType: z.enum(["outgoing", "reversal"]),
  reversalReference: Id.nullable(),
  description: z.string().max(2000),
});
export type Payment = z.infer<typeof Payment>;
export const Note = z.object({
  id: Id,
  vendorId: Id,
  date: DateOnly,
  text: z.string().max(4000),
  paymentIds: z.array(Id).max(100),
  invoiceIds: z.array(Id).max(100),
});
export const Dataset = z.object({
  vendors: z.array(Vendor),
  invoices: z.array(Invoice),
  payments: z.array(Payment),
  notes: z.array(Note),
});
export type Dataset = z.infer<typeof Dataset>;
export const Periods = z.object({
  priorStart: DateOnly,
  currentStart: DateOnly,
  endExclusive: DateOnly,
  timezone: z.literal("UTC"),
});
export const Summary = z.object({
  vendorId: Id,
  currency: z.literal("USD"),
  priorCents: Cents,
  currentCents: Cents,
  differenceCents: Cents,
  percentChange: z.number().finite().nullable(),
  periods: Periods,
});
export type Summary = z.infer<typeof Summary>;
export const Exception = z.object({
  id: Id,
  vendorId: Id,
  rule: z.enum(["payment_increase", "possible_duplicate"]),
  paymentIds: z.array(Id),
  summary: Summary,
  settings: z.object({
    minimumIncreaseCents: Cents,
    minimumPercent: z.number(),
    duplicateDays: z.number().int(),
  }),
});
export type Exception = z.infer<typeof Exception>;
export const EvidenceRef = z.object({
  type: z.enum(["payment", "invoice", "note"]),
  id: Id,
});
export const Finding = z.object({
  exceptionId: Id,
  label: z.enum(["Explained", "Needs Review", "Insufficient Evidence"]),
  explanation: z.string().min(1).max(4000),
  evidence: z.array(EvidenceRef).max(30),
  nextStep: z.string().min(1).max(1000),
  referenceStatus: z.enum(["valid", "invalid", "unchecked"]),
  supportStatus: z.enum(["unverified", "supported", "contradicted", "missing"]),
});
export type Finding = z.infer<typeof Finding>;
export const RunState = z.enum([
  "pending",
  "running",
  "completed",
  "incomplete",
  "failed",
  "cancelled",
]);
export const ErrorCode = z.enum([
  "unavailable",
  "invalid_input",
  "unauthorized",
  "deadline",
  "tool_limit",
  "model_limit",
  "invalid_evidence",
  "stale_generation",
  "internal",
]);
export const InvestigationInput = z.object({
  exception: Exception,
  generation: z.number().int().nonnegative(),
  acceptedAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
});
export type InvestigationInput = z.infer<typeof InvestigationInput>;
export const InvestigationResult = z.object({
  mode: z.enum(["stub", "real"]),
  state: RunState,
  findings: z.array(Finding).max(20),
  error: ErrorCode.nullable(),
  toolExecutions: z.number().int().min(0).max(8),
  modelRequests: z.number().int().min(0).max(10),
});
export type InvestigationResult = z.infer<typeof InvestigationResult>;
export const Run = InvestigationResult.extend({
  id: Id,
  exceptionId: Id,
  generation: z.number().int(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type Run = z.infer<typeof Run>;
export const ToolInputs = {
  get_payment_summary: z.object({}).strict(),
  list_payments: z
    .object({ paymentIds: z.array(Id).max(50).optional() })
    .strict(),
  get_invoices: z
    .object({ invoiceIds: z.array(Id).max(50).optional() })
    .strict(),
  get_vendor_notes: z
    .object({ noteIds: z.array(Id).max(50).optional() })
    .strict(),
};
export const ToolOutputs = {
  get_payment_summary: Summary,
  list_payments: z.array(Payment).max(100),
  get_invoices: z.array(Invoice).max(100),
  get_vendor_notes: z.array(Note).max(100),
};
export const DemoAction = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("inject"), scenarioId: z.literal("demo-v1") })
    .strict(),
  z.object({ action: z.literal("reset") }).strict(),
  z.object({ action: z.literal("review"), runId: Id }).strict(),
]);
export const DemoState = z.object({
  generation: z.number().int(),
  injected: z.boolean(),
  summaries: z.array(Summary),
  exceptions: z.array(Exception),
  runs: z.array(Run),
  dataset: Dataset,
});
export type DemoState = z.infer<typeof DemoState>;
export const MutationResponse = z.object({
  ok: z.literal(true),
  generation: z.number().int(),
  changed: z.boolean(),
});
