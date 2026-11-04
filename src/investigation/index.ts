import type {
  InvestigationInput,
  InvestigationResult,
  Summary,
  Payment,
  Dataset,
} from "../contracts";
export interface Investigator {
  investigate(
    input: InvestigationInput,
    signal: AbortSignal,
  ): Promise<InvestigationResult>;
}
export interface Retrieval {
  get_payment_summary(): Promise<Summary>;
  list_payments(input?: { paymentIds?: string[] }): Promise<Payment[]>;
  get_invoices(input?: { invoiceIds?: string[] }): Promise<Dataset["invoices"]>;
  get_vendor_notes(input?: { noteIds?: string[] }): Promise<Dataset["notes"]>;
}
