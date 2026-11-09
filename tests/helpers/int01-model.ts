import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "../../src/agent/loop";

export const call = (name: string, input: unknown = {}) => ({ type: "tool_use" as const, id: `fake_${name}`, name, input });
export const message = (content: unknown[]) => ({
  id: "offline-message", type: "message", role: "assistant", model: "offline-fake",
  content, stop_reason: "tool_use", stop_sequence: null,
  usage: { input_tokens: 0, output_tokens: 0 },
}) as unknown as Anthropic.Message;
export const draft = (id?: string) => ({
  label: id ? "Needs Review" : "Insufficient Evidence",
  explanation: "Offline fake draft for human review; no business cause verified.",
  evidence: id ? [{ type: "payment", id }] : [], nextStep: "Inspect the scoped synthetic records.",
});
/** Chooses a citation from actual DB tool output, never evaluator answers. */
export function syntheticModel(): ModelClient {
  return { async create(params, options) {
    if (options.maxRetries !== 0) throw new Error("SDK retries must be zero");
    if (options.signal.aborted) throw new Error("aborted");
    if (params.messages.length === 1) return message([
      call("list_payments"), call("get_invoices"), call("get_vendor_notes"),
    ]);
    const last = params.messages.at(-1)?.content;
    let id: string | undefined;
    if (Array.isArray(last)) {
      const tool = last.find(b => b.type === "tool_result" && b.tool_use_id === "fake_list_payments");
      if (tool?.type === "tool_result" && typeof tool.content === "string") {
        const rows = JSON.parse(tool.content).untrusted_records;
        if (Array.isArray(rows)) id = rows[0]?.id;
      }
    }
    return message([call("submit_findings", { findings: [draft(id)] })]);
  } };
}
