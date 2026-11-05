import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { main, runFeasibility } from "../evals/feasibility";
import type { ModelClient } from "../src/agent/loop";
import { SUBMIT_TOOL } from "../src/agent/tools";

// Offline only: a scripted fake client. No credentials, network or model calls.
let ids = 0;
const message = (
  content: unknown[],
  stop_reason: Anthropic.Message["stop_reason"] = "tool_use",
) =>
  ({
    id: `msg_${++ids}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 2_000, output_tokens: 500 },
  }) as unknown as Anthropic.Message;
const call = (name: string, input: unknown = {}) => ({
  type: "tool_use" as const,
  id: `toolu_${++ids}`,
  name,
  input,
});

function scripted(responses: Anthropic.Message[]) {
  const params: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = {
    async create(p) {
      params.push(p);
      const next = responses[params.length - 1];
      if (!next) throw new Error("script exhausted");
      return next;
    },
  };
  return { client, params };
}

const renewalRun = () =>
  scripted([
    message([call("list_payments"), call("get_invoices"), call("get_vendor_notes")]),
    message([
      call(SUBMIT_TOOL, {
        findings: [
          {
            label: "Explained",
            explanation: "Annual renewal invoice explains the $12,000 increase.",
            evidence: [
              { type: "payment", id: "pay-renewal-annual" },
              { type: "invoice", id: "inv-renewal" },
              { type: "note", id: "note-renewal" },
            ],
            nextStep: "Accounting reviews expense recognition.",
          },
        ],
      }),
    ]),
  ]);

describe("FEAS-01 feasibility report (offline)", () => {
  it("records configuration, counts, usage, validation and the comparison", async () => {
    const { client, params } = renewalRun();
    const report = await runFeasibility({ client, maxTokens: 16_000, effort: "low" });
    expect(params[0]).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16_000,
      output_config: { effort: "low" },
    });
    expect(report).toMatchObject({
      caseId: "renewal",
      versions: { fixture: "demo-v1", groundTruth: "ground-truth-v2", prompt: "prompt-v1" },
      configuration: { requestedModel: "claude-opus-5-5", servedModels: ["claude-opus-5-5"], sdkRetries: 0 },
      run: { state: "completed", error: null, toolExecutions: 3, modelRequests: 2 },
      usage: { inputTokens: 4_000, outputTokens: 1_000, estimatedCostUsd: 0.036 },
      comparison: {
        runStateMatches: true,
        expectedLabel: "Explained",
        validatedLabels: ["Explained"],
        labelAcceptable: true,
        verifiedExplanation: true,
        requiredEvidenceMissing: [],
        forbiddenClaimsMade: [],
        baseline: { label: "Needs Review", labelAcceptable: false },
      },
    });
    expect(report.run.stopReasons).toEqual(["tool_use", "tool_use"]);
    // The model's wording is kept separately from the verified explanation.
    expect(report.modelFindings[0].explanation).toContain("Annual renewal");
    expect(report.validatedFindings[0].explanation).toMatch(/^Application check: /);
  });

  it("reports a failed run honestly, with forbidden claims and missing evidence", async () => {
    const { client } = scripted([
      message([
        call(SUBMIT_TOOL, {
          findings: [
            {
              label: "Explained",
              explanation: "This is a confirmed duplicate; the refund is due.",
              evidence: [{ type: "payment", id: "pay-renewal-annual" }],
              nextStep: "Release the remaining balance.",
            },
          ],
        }),
      ]),
    ]);
    const report = await runFeasibility({ client });
    expect(report.comparison.verifiedExplanation).toBe(false);
    expect(report.comparison.validatedLabels).toEqual(["Needs Review"]);
    expect(report.comparison.requiredEvidenceMissing.length).toBeGreaterThan(0);
    const truncated = scripted([message([], "max_tokens")]);
    const cut = await runFeasibility({ client: truncated.client });
    expect(cut.run).toMatchObject({ state: "failed", stopReasons: ["max_tokens"] });
    expect(cut.comparison.runStateMatches).toBe(false);
  });

  it("refuses held-out and harness-condition cases without calling the model", async () => {
    const create = vi.fn();
    for (const caseId of ["lookalike", "annual-premium", "tool-limit", "nope"])
      await expect(runFeasibility({ client: { create }, caseId })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("makes no call and reads no client without --allow-paid or a key", async () => {
    const makeClient = vi.fn();
    const warn = vi.fn();
    expect(await main([], { ANTHROPIC_API_KEY: "test-key" }, makeClient, vi.fn(), warn)).toBe(1);
    expect(await main(["--allow-paid"], {}, makeClient, vi.fn(), warn)).toBe(1);
    expect(await main(["--allow-paid", "--effort", "extreme"], { ANTHROPIC_API_KEY: "k" }, makeClient, vi.fn(), warn)).toBe(1);
    expect(makeClient).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toContain("test-key");
  });

  it("writes a report that contains no credentials", async () => {
    const write = vi.fn();
    const env = { ANTHROPIC_API_KEY: "sk-ant-test-secret-value" };
    expect(await main(["--allow-paid"], env, () => renewalRun().client, write, vi.fn())).toBe(0);
    const text = write.mock.calls.flat().join("");
    expect(JSON.parse(text).comparison.labelAcceptable).toBe(true);
    expect(text).not.toContain("sk-ant");
  });
});
