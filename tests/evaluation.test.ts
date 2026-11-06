import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  TOOL_LIMIT_CONDITION,
  evaluate,
  evaluateBaseline,
  scoreCase,
  type CaseRun,
} from "../evals/evaluate";
import { main } from "../evals/real";
import { loadGroundTruth } from "../evals/ground-truth";
import { createRealInvestigator, type ModelClient } from "../src/agent/loop";
import { SUBMIT_TOOL } from "../src/agent/tools";
import { detect } from "../src/domain/finance";
import { injectedDataset } from "../src/fixtures/scenarios";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import type { Finding } from "../src/contracts";

// Offline only: scripted fake clients. No credentials, network or model calls.
let ids = 0;
const message = (content: unknown[]) =>
  ({
    id: `msg_${++ids}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1_000, output_tokens: 200 },
  }) as unknown as Anthropic.Message;
const call = (name: string, input: unknown = {}) => ({
  type: "tool_use" as const,
  id: `toolu_${++ids}`,
  name,
  input,
});
const submit = (findings: unknown[]) => message([call(SUBMIT_TOOL, { findings })]);

/** Replies per case in order; records every tool result the loop sent back. */
function scripted(script: Anthropic.Message[]) {
  const toolResults: string[] = [];
  let n = 0;
  const client: ModelClient = {
    async create(p) {
      const last = p.messages.at(-1);
      if (last && Array.isArray(last.content))
        for (const b of last.content)
          if (b.type === "tool_result") toolResults.push(String(b.content));
      const next = script[n++];
      if (!next) throw new Error("script exhausted");
      return next;
    },
  };
  return { client, toolResults, calls: () => n };
}

const truth = loadGroundTruth();
const dev = (id: string) => truth.development.cases.find((c) => c.id === id)!;
const finding = (f: Partial<Finding>): Finding => ({
  exceptionId: "x",
  label: "Needs Review",
  explanation: "Explanation.",
  evidence: [],
  nextStep: "Review.",
  referenceStatus: "valid",
  supportStatus: "unverified",
  ...f,
});
const run = (validated: Finding[], state: CaseRun["state"] = "completed"): CaseRun => ({
  state,
  error: null,
  findings: validated,
  validated,
});

describe("EVAL-01 scoring is independent of model self-assessment", () => {
  it("accepts a correct main finding with a cautious side question", () => {
    const expected = dev("renewal");
    const s = scoreCase(
      expected,
      run([
        finding({
          label: "Explained",
          supportStatus: "supported",
          evidence: expected.requiredEvidence,
        }),
        finding({ label: "Needs Review" }),
      ]),
    );
    expect(s).toMatchObject({
      labelAcceptable: true,
      verifiedExplanation: true,
      unsupportedExplained: 0,
      requiredEvidence: { required: 3, cited: 3, missing: [] },
      failures: [],
    });
  });

  it("counts Explained as unsupported when the case does not allow it or it is unverified", () => {
    const dup = scoreCase(
      dev("duplicate-payments"),
      run([finding({ label: "Explained", supportStatus: "supported" })]),
    );
    expect(dup.unsupportedExplained).toBe(1);
    expect(dup.failures).toEqual(
      expect.arrayContaining(["label_unacceptable", "unsupported_explained", "missing_required_evidence"]),
    );
    // A model's own "supported" is never trusted: only validated status counts.
    const unverified = scoreCase(
      dev("renewal"),
      run([finding({ label: "Explained", supportStatus: "unverified" })]),
    );
    expect(unverified.unsupportedExplained).toBe(1);
    expect(unverified.verifiedExplanation).toBe(false);
  });

  it("scores 'any stated business cause' as any validated Explained finding", () => {
    const s = scoreCase(
      dev("missing-evidence"),
      run([finding({ label: "Explained", supportStatus: "supported" })]),
    );
    expect(s.forbiddenClaimsMade).toEqual(["any stated business cause"]);
    expect(
      scoreCase(dev("missing-evidence"), run([finding({ label: "Insufficient Evidence" })]))
        .failures,
    ).toEqual([]);
  });

  it("matches literal forbidden claims in the model's own wording, case-insensitively", () => {
    const s = scoreCase(
      dev("duplicate-payments"),
      run([finding({ explanation: "This is a Confirmed Duplicate." })]),
    );
    expect(s.forbiddenClaimsMade).toEqual(["confirmed duplicate"]);
  });

  it("flags run-state mismatches, failed runs and missing findings", () => {
    const s = scoreCase(dev("renewal"), run([], "failed"));
    expect(s.failures).toEqual(
      expect.arrayContaining(["run_state_mismatch", "run_failed", "no_findings", "label_unacceptable"]),
    );
    // Harness-condition cases may end with no findings.
    expect(scoreCase(dev("retrieval-failure"), run([], "incomplete")).failures).toEqual([]);
  });
});

describe("EVAL-01 harness conditions and the paired report (offline)", () => {
  it("runs the model and the baseline on the same case and scores both", async () => {
    const { client } = scripted([
      message([call("list_payments"), call("get_invoices"), call("get_vendor_notes")]),
      submit([
        {
          label: "Insufficient Evidence",
          explanation: "No invoice or note is on file for the October payment.",
          evidence: [],
          nextStep: "Request the October invoice from the vendor.",
        },
      ]),
    ]);
    const report = await evaluate("development", { client, caseIds: ["missing-evidence"] });
    expect(report).toMatchObject({
      mode: "model-and-baseline",
      split: "development",
      versions: { groundTruth: "ground-truth-v2", prompt: "prompt-v1", baseline: "rules-v2" },
      configuration: { requestedModel: "claude-opus-5-5", sdkRetries: 0, toolLimitCondition: 1 },
      usage: { modelRequests: 2, toolExecutions: 3, inputTokens: 2_000, outputTokens: 400 },
      summary: {
        model: { cases: 1, labelAcceptable: 1, unsupportedExplained: 0 },
        baseline: { cases: 1, labelAcceptable: 1, unsupportedExplained: 0 },
      },
      reviewTime: { status: "unavailable" },
    });
    expect(report.model[0]).toMatchObject({ state: "completed", score: { failures: [] } });
    expect(report.baseline[0]).toMatchObject({ label: "Insufficient Evidence" });
  });

  it("retrieval_failure: every retrieval fails and the run is incomplete", async () => {
    const { client, toolResults } = scripted([
      message([call("list_payments"), call("get_invoices")]),
      submit([
        {
          label: "Explained",
          explanation: "The renewal explains the increase.",
          evidence: [{ type: "payment", id: "pay-renewal-annual" }],
          nextStep: "Review.",
        },
      ]),
    ]);
    const report = await evaluate("development", { client, caseIds: ["retrieval-failure"] });
    expect(toolResults).toEqual(["Retrieval failed.", "Retrieval failed."]);
    expect(report.model[0]).toMatchObject({ state: "incomplete", error: "unavailable" });
    // The loop never lets an incomplete run stand as Explained.
    expect(report.model[0].validatedFindings.map((f) => f.label)).not.toContain("Explained");
    expect(report.model[0].score.unsupportedExplained).toBe(0);
    expect(report.baseline[0]).toMatchObject({ state: "incomplete", label: "Insufficient Evidence" });
  });

  it("tool_limit: only one retrieval runs, then the loop reports the limit", async () => {
    const { client, toolResults } = scripted([
      message([call("get_payment_summary"), call("list_payments"), call("get_invoices")]),
      submit([
        {
          label: "Insufficient Evidence",
          explanation: "The retrieval limit was reached before invoices were read.",
          evidence: [],
          nextStep: "Retrieve the invoices and notes.",
        },
      ]),
    ]);
    const report = await evaluate("development", { client, caseIds: ["tool-limit"] });
    expect(TOOL_LIMIT_CONDITION).toBe(1);
    expect(toolResults[0]).toContain("untrusted_records");
    expect(toolResults.slice(1)).toEqual([
      "Retrieval limit reached. Submit findings now and state the remaining gaps.",
      "Retrieval limit reached. Submit findings now and state the remaining gaps.",
    ]);
    expect(report.model[0]).toMatchObject({
      state: "incomplete",
      error: "tool_limit",
      toolExecutions: 1,
      score: { failures: [] },
    });
  });

  it("a harness can only lower the retrieval budget, never raise it above 8", async () => {
    const data = injectedDataset();
    const exception = detect(data)[0];
    const many = Array.from({ length: 12 }, () => call("get_payment_summary"));
    const { client } = scripted([message(many), submit([])]);
    const result = await createRealInvestigator({
      client,
      model: "claude-opus-5-5",
      toolLimit: 50,
      retrievalFor: () => fixtureRetrieval(data, exception),
    }).investigate(
      {
        exception,
        generation: 0,
        acceptedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      },
      new AbortController().signal,
    );
    expect(result.toolExecutions).toBe(8);
  });
});

describe("EVAL-01 baseline (rules-v2) on development cases (offline)", () => {
  it("scores the baseline with no model call", async () => {
    const report = await evaluateBaseline("development");
    expect(report).toMatchObject({
      mode: "baseline-only",
      modelRequests: 0,
      versions: { baseline: "rules-v2" },
      summary: { cases: 9, unsupportedExplained: 0 },
    });
    // The baseline's record checks are the validator's, which were tuned on
    // these development cases, so this is not evidence of generalization.
    expect(report.summary.labelAcceptable).toBe(9);
  });

  it("never states a business cause of its own", async () => {
    const report = await evaluateBaseline("development");
    for (const c of report.cases)
      if (c.label === "Explained") expect(c.explanation).toMatch(/^Application check: /);
      else expect(c.explanation).not.toMatch(/renewal|retainer|software/i);
  });
});

describe("EVAL-01 real-evaluation CLI makes no call unless opted in", () => {
  const env = { ANTHROPIC_API_KEY: "test-key-not-real" };
  it.each([
    [[], env, "requires explicit --allow-paid"],
    [["--allow-paid", "--split", "held-out"], env, "add --final"],
    [["--allow-paid"], {}, "ANTHROPIC_API_KEY is not set"],
    [["--allow-paid", "--split", "other"], env, "--split must be"],
  ])("%j refuses without calling the model", async (argv, e, warning) => {
    const makeClient = vi.fn();
    const warn = vi.fn();
    expect(await main(argv, e, makeClient, vi.fn(), warn)).toBe(1);
    expect(makeClient).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain(warning);
  });

  it("refuses unknown cases before any call and never prints the key", async () => {
    const create = vi.fn();
    const warn = vi.fn();
    const write = vi.fn();
    const code = await main(
      ["--allow-paid", "--case", "no-such-case"],
      env,
      () => ({ create }),
      write,
      warn,
    );
    expect(code).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(JSON.stringify([warn.mock.calls, write.mock.calls])).not.toContain("test-key-not-real");
  });
});
