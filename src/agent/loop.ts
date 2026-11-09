import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import {
  ToolInputs,
  ToolOutputs,
  type ErrorCode,
  type Finding,
  type InvestigationInput,
  type InvestigationResult,
} from "../contracts";
import type { Investigator, Retrieval } from "../investigation";
import { Budget, RunError } from "../investigation/budget";
import { SYSTEM_PROMPT, investigationRequest } from "./prompt";
import {
  SUBMIT_TOOL,
  Submission,
  modelTools,
  retrievalToolNames,
  type RetrievalToolName,
} from "./tools";

type Code = z.infer<typeof ErrorCode>;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The one SDK call the loop makes; tests pass a fake. */
export interface ModelClient {
  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { signal: AbortSignal; timeout: number; maxRetries: 0 },
  ): Promise<Anthropic.Message>;
}

export interface RequestTelemetry {
  model: string;
  requestedModel: string;
  stopReason: Anthropic.Message["stop_reason"];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RealInvestigatorOptions {
  client: ModelClient;
  model: string;
  effort?: Effort;
  /**
   * Response limit per request, including the model's thinking. FEAS-01
   * measures whether the default cuts responses off before it is changed.
   */
  maxTokens?: number;
  /** Application-scoped, read-only retrieval for the claimed exception. */
  retrievalFor(input: InvestigationInput): Retrieval | Promise<Retrieval>;
  now?: () => number;
  /** Time kept back from the run deadline for validation and persistence. */
  reserveMs?: number;
  /** Per-request counters for evaluations; never receives credentials. */
  onRequest?(telemetry: RequestTelemetry): void;
  /**
   * Evaluation harness only (EVAL-01 `tool_limit` condition): a lower
   * retrieval limit. It can only tighten the 8-execution budget (INV-08).
   */
  toolLimit?: number;
}

export const DEFAULT_MODEL = "claude-opus-5-5";
export const VALIDATION_RESERVE_MS = 10_000;
export const DEFAULT_MAX_TOKENS = 8_000;
/** INV-08 retrieval budget, enforced by `Budget`; a harness may only lower it. */
const MAX_TOOL_EXECUTIONS = 8;
// Contract limits already bound records; this also bounds the text sent back.
const MAX_TOOL_RESULT_CHARS = 60_000;

const result = (
  state: InvestigationResult["state"],
  error: Code | null,
  budget: Budget,
  findings: Finding[] = [],
): InvestigationResult => ({
  mode: "real",
  state,
  error,
  findings,
  toolExecutions: budget.toolExecutions,
  modelRequests: budget.modelRequests,
});

const toolResult = (
  id: string,
  content: string,
  isError = false,
): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content,
  ...(isError ? { is_error: true } : {}),
});

async function runRetrieval(
  retrieval: Retrieval,
  name: RetrievalToolName,
  input: Record<string, never> | { [key: string]: string[] | undefined },
) {
  switch (name) {
    case "get_payment_summary":
      return ToolOutputs.get_payment_summary.parse(
        await retrieval.get_payment_summary(),
      );
    case "list_payments":
      return ToolOutputs.list_payments.parse(
        await retrieval.list_payments(input),
      );
    case "get_invoices":
      return ToolOutputs.get_invoices.parse(
        await retrieval.get_invoices(input),
      );
    case "get_vendor_notes":
      return ToolOutputs.get_vendor_notes.parse(
        await retrieval.get_vendor_notes(input),
      );
  }
}

/**
 * One bounded, explicit tool-calling loop. Code, not the prompt, enforces the
 * 8-retrieval / 10-request / deadline budget, the tool allowlist and the output
 * schema. Every outcome is reported honestly; there is no fallback to the stub.
 */
export function createRealInvestigator(
  options: RealInvestigatorOptions,
): Investigator {
  const now = options.now ?? Date.now;
  const reserve = options.reserveMs ?? VALIDATION_RESERVE_MS;
  const toolLimit = Math.min(
    MAX_TOOL_EXECUTIONS,
    Math.max(0, Math.floor(options.toolLimit ?? MAX_TOOL_EXECUTIONS)),
  );
  return {
    async investigate(input, signal) {
      const budget = new Budget(Date.parse(input.deadlineAt) - reserve, now);
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) abort();
      signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, Math.max(0, budget.deadline - now()));
      // Distinguish our own deadline from an external cancellation (e.g. reset).
      const stopped = (): InvestigationResult =>
        signal.aborted && now() < budget.deadline
          ? result("cancelled", null, budget)
          : result("incomplete", "deadline", budget);
      try {
        let retrieval: Retrieval;
        try {
          retrieval = await options.retrievalFor(input);
        } catch {
          return result("failed", "unavailable", budget);
        }
        const messages: Anthropic.MessageParam[] = [
          { role: "user", content: investigationRequest(input.exception) },
        ];
        let retrievalFailed = false;
        let limitReached = false;
        while (true) {
          if (controller.signal.aborted) return stopped();
          try {
            budget.takeModel();
          } catch (error) {
            if (error instanceof RunError)
              return error.code === "deadline"
                ? stopped()
                : result("incomplete", error.code, budget);
            throw error;
          }
          const started = now();
          let response: Anthropic.Message;
          try {
            response = await options.client.create(
              {
                model: options.model,
                max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                system: SYSTEM_PROMPT,
                tools: modelTools,
                messages,
                output_config: { effort: options.effort ?? "medium" },
              },
              {
                signal: controller.signal,
                timeout: Math.max(1, budget.deadline - now()),
                maxRetries: 0,
              },
            );
          } catch {
            if (controller.signal.aborted) return stopped();
            return result("failed", "unavailable", budget);
          }
          options.onRequest?.({
            model: response.model,
            requestedModel: options.model,
            stopReason: response.stop_reason,
            latencyMs: now() - started,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          });
          if (controller.signal.aborted) return stopped();
          if (response.stop_reason === "refusal")
            return result("failed", "unavailable", budget);
          // Truncated output may carry incomplete tool input; never act on it.
          if (response.stop_reason === "max_tokens")
            return result("failed", "internal", budget);
          messages.push({ role: "assistant", content: response.content });
          const calls = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (!calls.length) return result("failed", "internal", budget);

          const results: Anthropic.ToolResultBlockParam[] = [];
          let submitted: Finding[] | null = null;
          for (const call of calls) {
            if (call.name === SUBMIT_TOOL) {
              const parsed = Submission.safeParse(call.input);
              if (!parsed.success) {
                results.push(
                  toolResult(
                    call.id,
                    `Rejected: findings do not match the schema. ${parsed.error.issues
                      .slice(0, 5)
                      .map((i) => `${i.path.join(".")}: ${i.message}`)
                      .join("; ")}`,
                    true,
                  ),
                );
                continue;
              }
              submitted = parsed.data.findings.map((f) => ({
                ...f,
                // Application-owned fields; model self-assessment is discarded.
                exceptionId: input.exception.id,
                referenceStatus: "unchecked",
                supportStatus: "unverified",
              }));
              results.push(toolResult(call.id, "Findings received."));
              continue;
            }
            // Every attempted retrieval counts, including unknown/invalid ones.
            try {
              if (budget.toolExecutions >= toolLimit)
                throw new RunError("tool_limit");
              budget.takeTool();
            } catch (error) {
              if (error instanceof RunError && error.code === "tool_limit") {
                limitReached = true;
                results.push(
                  toolResult(
                    call.id,
                    "Retrieval limit reached. Submit findings now and state the remaining gaps.",
                    true,
                  ),
                );
                continue;
              }
              if (error instanceof RunError) return stopped();
              throw error;
            }
            if (!retrievalToolNames.includes(call.name as RetrievalToolName)) {
              results.push(
                toolResult(call.id, `Unknown tool: ${call.name}.`, true),
              );
              continue;
            }
            const name = call.name as RetrievalToolName;
            // Strict schemas: model-supplied keys such as SQL or scope are rejected.
            const parsedInput = ToolInputs[name].safeParse(call.input);
            if (!parsedInput.success) {
              results.push(toolResult(call.id, "Invalid tool input.", true));
              continue;
            }
            try {
              const output = await runRetrieval(
                retrieval,
                name,
                parsedInput.data,
              );
              const text = JSON.stringify({ untrusted_records: output });
              results.push(
                text.length > MAX_TOOL_RESULT_CHARS
                  ? toolResult(call.id, "Retrieval result too large.", true)
                  : toolResult(call.id, text),
              );
            } catch {
              if (controller.signal.aborted) return stopped();
              retrievalFailed = true;
              results.push(toolResult(call.id, "Retrieval failed.", true));
            }
          }
          if (submitted) {
            if (controller.signal.aborted) return stopped();
            if (!retrievalFailed && !limitReached)
              return result("completed", null, budget, submitted);
            // Missing evidence: nothing from this run can stand as Explained.
            return result(
              "incomplete",
              retrievalFailed ? "unavailable" : "tool_limit",
              budget,
              submitted.map((f) =>
                f.label === "Explained" ? { ...f, label: "Needs Review" } : f,
              ),
            );
          }
          messages.push({ role: "user", content: results });
        }
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
