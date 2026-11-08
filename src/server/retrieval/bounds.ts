import { periods, settings } from "../../domain/finance";

export const retrievalLimits = Object.freeze({ rows: 100, textBytes: 65536, recordBytes: 24576 });
export class RetrievalError extends Error {
  constructor(readonly code: "invalid_input" | "unavailable" | "stale_generation" | "evidence_limit" | "invalid_scope") {
    super(`Retrieval ${code}`);
    this.name = "RetrievalError";
  }
}
export function duplicateLookbackStart() {
  const date = new Date(`${periods.currentStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - settings.duplicateDays);
  return date.toISOString().slice(0, 10);
}
export function bounded<T>(value: T): T {
  if ((Array.isArray(value) && (value.length > retrievalLimits.rows || value.some(row => Buffer.byteLength(JSON.stringify(row), "utf8") > retrievalLimits.recordBytes))) ||
      Buffer.byteLength(JSON.stringify(value), "utf8") > retrievalLimits.textBytes)
    throw new RetrievalError("evidence_limit");
  return value;
}
