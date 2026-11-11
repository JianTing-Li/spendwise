import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  TOOL_LIMIT_CONDITION,
  evaluate,
  evaluateBaseline,
  scoreCase,
  statedCauses,
  type CaseRun,
} from "../evals/evaluate";
import { main } from "../evals/real";
import { main as scoreBaselineMain } from "../evals/score-baseline";
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

  it("scores 'any stated business cause' as made for any validated Explained finding", () => {
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

  it("never scores an affirmative cause clean because of a cautious label", () => {
    // Elliot's PR #33 reproduction: tool-limit, incomplete, Needs Review.
    const stated = "The increase was caused by an annual software renewal.";
    for (const label of ["Needs Review", "Insufficient Evidence"] as const) {
      const s = scoreCase(
        dev("tool-limit"),
        run([finding({ label, explanation: stated, evidence: [] })], "incomplete"),
      );
      expect(s.labelAcceptable).toBe(true);
      expect(s.failures).toEqual([]);
      expect(s.forbiddenClaimsNeedReview).toEqual([
        { claim: "any stated business cause", sentences: [stated] },
      ]);
      expect(s.needsReview).toEqual(["forbidden_claim"]);
    }
    // Wording in the next step counts too.
    const next = scoreCase(
      dev("missing-evidence"),
      run([
        finding({
          label: "Insufficient Evidence",
          explanation: "No invoice is linked.",
          nextStep: "Confirm the jump is due to the new contract rate.",
        }),
      ]),
    );
    expect(next.needsReview).toEqual(["forbidden_claim"]);
  });

  it("counts a claim the validator downgraded as stated", () => {
    const claimed = finding({
      label: "Explained",
      explanation: "The increase is explained by an annual renewal.",
      evidence: [],
    });
    const s = scoreCase(dev("missing-evidence"), {
      state: "completed",
      error: null,
      findings: [claimed],
      validated: [{ ...claimed, label: "Needs Review", supportStatus: "missing" }],
    });
    expect(s.forbiddenClaimsMade).toEqual(["any stated business cause"]);
    expect(s.failures).toContain("forbidden_claim");
    expect(s.overclaimsCaughtByValidation).toBe(1);
  });

  it("leaves genuine uncertainty and negation clean, and hedged guesses for review", () => {
    for (const explanation of [
      "Nothing explains why the October payment is larger.",
      "The records do not explain the increase, and no cause could be determined.",
      "Retrieval failed, so no conclusion was reached.",
      "Nothing suggests a duplicate payment.",
      "A person must decide whether the increase is explained.",
    ]) {
      const s = scoreCase(
        dev("missing-evidence"),
        run([finding({ label: "Insufficient Evidence", explanation })]),
      );
      expect(s.forbiddenClaimsNeedReview).toEqual([]);
      expect(s.needsReview).toEqual([]);
      expect(s.failures).toEqual([]);
    }
    // A guess is still a stated cause until a person decides otherwise.
    expect(
      statedCauses([
        finding({
          explanation:
            "The payment ID suggests an annual renewal, which could explain the increase. No record supports that.",
          nextStep: "",
        }),
      ]),
    ).toEqual([
      "The payment ID suggests an annual renewal, which could explain the increase.",
    ]);
    // A contrast after a negator does not hide the cause.
    expect(
      statedCauses([
        finding({ explanation: "It was not random but driven by a price change.", nextStep: "" }),
      ]),
    ).toHaveLength(1);
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
      versions: { groundTruth: "ground-truth-v2", prompt: "prompt-v2", baseline: "rules-v3" },
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

describe("EVAL-01 baseline (rules-v3) on development cases (offline)", () => {
  it("scores the baseline with no model call", async () => {
    const report = await evaluateBaseline("development");
    expect(report).toMatchObject({
      mode: "baseline-only",
      modelRequests: 0,
      versions: { baseline: "rules-v3" },
      summary: { cases: 9, unsupportedExplained: 0 },
    });
    // The baseline's record checks are the validator's, which were tuned on
    // these development cases, so this is not evidence of generalization.
    expect(report.summary.labelAcceptable).toBe(9);
  });

  it("never states a business cause of its own", async () => {
    const report = await evaluateBaseline("development");
    for (const c of report.cases)
      if (c.label === "Explained") expect(c.explanation).toMatch(/^- \$[0-9,.]+ paid /);
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

  it("refuses held-out without --final before any case is loaded", async () => {
    const makeClient = vi.fn();
    const warn = vi.fn();
    await expect(evaluate("held-out", { client: { create: vi.fn() } })).rejects.toThrow(
      "add --final",
    );
    expect(await main(["--allow-paid", "--split", "held-out"], env, makeClient, vi.fn(), warn)).toBe(1);
    expect(makeClient).not.toHaveBeenCalled();
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

describe("EVAL-01 baseline scoring CLI guards held-out like eval:real", () => {
  // Never scores held-out: the refusals happen before any case is loaded,
  // and the accepted path uses a stub scorer.
  it.each([
    [["--split", "held-out"], "add --final"],
    [["--split", "other"], "--split must be"],
  ])("%j refuses without scoring", async (argv, warning) => {
    const score = vi.fn();
    const write = vi.fn();
    const warn = vi.fn();
    expect(await scoreBaselineMain(argv, score, write, warn)).toBe(1);
    expect(score).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain(warning);
  });

  it("refuses held-out in the library itself, not only in the CLI", async () => {
    await expect(evaluateBaseline("held-out")).rejects.toThrow("add --final");
  });

  it("passes development and confirmed held-out through to the scorer", async () => {
    const score = vi.fn().mockResolvedValue({ ok: true });
    const write = vi.fn();
    expect(await scoreBaselineMain([], score, write, vi.fn())).toBe(0);
    expect(score).toHaveBeenLastCalledWith("development", { final: false });
    expect(await scoreBaselineMain(["--split", "held-out", "--final"], score, write, vi.fn())).toBe(0);
    expect(score).toHaveBeenLastCalledWith("held-out", { final: true });
  });
});
