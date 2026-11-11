/**
 * EVAL-01: scores the investigator and the rule-based baseline on the same
 * records against evaluator-only expected answers (INV-11). Scoring uses the
 * application's own validation and the expected answers, never the model's
 * self-assessment. The expected answers are read here only, after a run.
 */
import { detect } from "../src/domain/finance";
import { FIXTURE_VERSION, injectedDataset } from "../src/fixtures/scenarios";
import {
  EVALUATION_FIXTURE_VERSION,
  developmentDataset,
  heldOutDataset,
} from "../src/fixtures/evaluation";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  VALIDATION_RESERVE_MS,
  createRealInvestigator,
  type Effort,
  type ModelClient,
  type RequestTelemetry,
} from "../src/agent/loop";
import { PROMPT_VERSION } from "../src/agent/prompt";
import { isVerifiedExplanation, validateFinding } from "../src/agent/validation";
import type { Retrieval } from "../src/investigation";
import type {
  Dataset,
  Exception,
  Finding,
  InvestigationInput,
  InvestigationResult,
} from "../src/contracts";
import { loadGroundTruth, type GroundTruthCase } from "./ground-truth";
import { BASELINE_VERSION, baselineFor } from "./baseline";

export const EVALUATOR_VERSION = "evaluator-v3";
const RUN_MS = 60_000;
/** Retrievals allowed under the `tool_limit` condition (the real limit is 8). */
export const TOOL_LIMIT_CONDITION = 1;
/** Forbidden-claim text that cannot be matched literally; see `statedCauses`. */
const ANY_CAUSE = "any stated business cause";
/** Refusal for held-out cases without explicit final confirmation (decision 004). */
export const HELD_OUT_REFUSAL =
  "Held-out cases run once, after tuning ends: add --final to confirm.";

/** Wording that attributes, explains or suggests a cause. */
const CAUSE =
  /\b(?:caused by|cause (?:is|was|of)|due to|driven by|attribut(?:able|ed) to|(?:the )?result(?:s|ed)? (?:of|from)|explain(?:s|ed|ing)?|because of|stem(?:s|med)? from|reflect(?:s|ed)?|reason (?:for|is|was)|consistent with|suggest(?:s|ed)?|likely|probably)\b/g;
/** A negator or "whether" shortly before the cause wording, with no contrast after it. */
const NEGATED =
  /\b(?:no|not|nothing|none|never|neither|nor|cannot|can't|unable to|does not|do not|did not|could not|couldn't|doesn't|don't|didn't|whether)\b(?!.*\b(?:but|however|rather|instead)\b)(?:\W+\w+){0,4}\W*$/;

/**
 * Sentences that may state a business cause, whatever the finding's label: any
 * cause, explanation or suggestion wording that is not directly negated or
 * put as a question ("nothing explains the increase" and "decide whether it is
 * explained" are not flagged; "the increase was caused by a renewal" and "this
 * could explain the increase" are). Matching is a review
 * aid, not a judgment: a flagged sentence stays unresolved until a person
 * decides, and a reworded cause with none of this wording is not found.
 */
export function statedCauses(findings: Finding[]) {
  const sentences = findings.flatMap((f) =>
    `${f.summary ?? ""}\n${f.explanation}\n${f.nextStep}`.split(/(?<=[.;:!?])\s+|\n+/),
  );
  return sentences
    .map((s) => s.trim())
    .filter((s) =>
      [...s.toLowerCase().matchAll(CAUSE)].some(
        (m) => !NEGATED.test(s.toLowerCase().slice(0, m.index)),
      ),
    );
}

/** List prices per million tokens (USD), for an estimate only; no cache discounts. */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export type Split = "development" | "held-out";

/**
 * Shared CLI guard for every evaluation entry point: reads `--split` and
 * refuses held-out without `--final`, before any case is loaded or scored.
 */
export function splitFrom(argv: string[]): { split: Split; final: boolean } | { error: string } {
  const i = argv.indexOf("--split");
  const split = i >= 0 ? argv[i + 1] : "development";
  if (split !== "development" && split !== "held-out")
    return { error: "--split must be development or held-out." };
  const final = argv.includes("--final");
  if (split === "held-out" && !final) return { error: HELD_OUT_REFUSAL };
  return { split, final };
}
export type FailureCategory =
  | "run_state_mismatch"
  | "run_failed"
  | "no_findings"
  | "label_unacceptable"
  | "unsupported_explained"
  | "invalid_reference"
  | "missing_required_evidence"
  | "forbidden_claim";

export function datasetFor(c: GroundTruthCase): Dataset {
  if (c.datasetId === "demo-v1") return injectedDataset();
  if (c.datasetId === "eval-dev-v1") return developmentDataset;
  return heldOutDataset;
}

export function fixtureVersionFor(c: GroundTruthCase) {
  return c.datasetId === "demo-v1"
    ? FIXTURE_VERSION
    : `${c.datasetId} (${EVALUATION_FIXTURE_VERSION})`;
}

/** Every retrieval throws: the `retrieval_failure` harness condition. */
const failing = (): Retrieval => {
  const fail = async (): Promise<never> => {
    throw new Error("Retrieval unavailable (evaluation harness).");
  };
  return {
    get_payment_summary: fail,
    list_payments: fail,
    get_invoices: fail,
    get_vendor_notes: fail,
  };
};

/** Allows `limit` retrievals, then throws: the baseline's `tool_limit` condition. */
function limited(inner: Retrieval, limit: number): Retrieval {
  let used = 0;
  const take = <T>(run: () => Promise<T>) => {
    if (used++ >= limit)
      return Promise.reject(new Error("Retrieval limit reached (evaluation harness)."));
    return run();
  };
  return {
    get_payment_summary: () => take(() => inner.get_payment_summary()),
    list_payments: (i) => take(() => inner.list_payments(i)),
    get_invoices: (i) => take(() => inner.get_invoices(i)),
    get_vendor_notes: (i) => take(() => inner.get_vendor_notes(i)),
  };
}

export interface CaseRun {
  state: InvestigationResult["state"];
  error: string | null;
  /** Findings as the method produced them, before application validation. */
  findings: Finding[];
  /** Findings after application validation (what a reviewer sees). */
  validated: Finding[];
}

const refKey = (e: { type: string; id: string }) => `${e.type}:${e.id}`;

/**
 * Scores one run against one expected answer. Labels are judged after
 * validation; the model's own labels count only to show overclaims the
 * application caught. Cause correctness is a human judgment and is never
 * scored automatically.
 *
 * A run's labels are acceptable when at least one finding has an acceptable
 * label and no finding is `Explained` unless `Explained` is acceptable, so a
 * correct main finding plus a cautious side question still passes.
 */
export function scoreCase(expected: GroundTruthCase, run: CaseRun) {
  const labels = run.validated.map((f) => f.label);
  const explainedOk = expected.acceptableLabels.includes("Explained");
  const labelAcceptable = labels.length
    ? labels.some((l) => expected.acceptableLabels.includes(l)) &&
      (explainedOk || !labels.includes("Explained"))
    : expected.allowNoFindings === true;
  const unsupportedExplained = run.validated.filter(
    (f) => f.label === "Explained" && (!explainedOk || !isVerifiedExplanation(f)),
  ).length;
  const cited = new Set(run.findings.flatMap((f) => f.evidence.map(refKey)));
  const missing = expected.requiredEvidence.map(refKey).filter((k) => !cited.has(k));
  const invalidReferences = run.validated.filter(
    (f) => f.referenceStatus === "invalid",
  ).length;
  const text = run.findings
    // The summary is the card's headline, so it is checked like the rest of the wording.
    .map((f) => `${f.summary ?? ""}\n${f.explanation}\n${f.nextStep}`.toLowerCase())
    .join("\n");
  // "Any stated business cause" is made when the method labels anything
  // Explained, before or after validation (a downgraded claim was still
  // stated). Cause wording under any other label stays unresolved for a
  // person to decide; it never scores clean on the label alone.
  const anyExplained = [...labels, ...run.findings.map((f) => f.label)].includes("Explained");
  const forbiddenClaimsMade = expected.forbiddenClaims.filter((claim) =>
    claim === ANY_CAUSE ? anyExplained : text.includes(claim.toLowerCase()),
  );
  const causeSentences =
    expected.forbiddenClaims.includes(ANY_CAUSE) && !anyExplained
      ? statedCauses(run.findings)
      : [];
  const forbiddenClaimsNeedReview = causeSentences.length
    ? [{ claim: ANY_CAUSE, sentences: causeSentences }]
    : [];
  const failures: FailureCategory[] = [];
  if (run.state !== expected.expectedRunState) failures.push("run_state_mismatch");
  if (run.state === "failed" || run.state === "cancelled") failures.push("run_failed");
  if (!run.validated.length && !expected.allowNoFindings) failures.push("no_findings");
  if (!labelAcceptable) failures.push("label_unacceptable");
  if (unsupportedExplained) failures.push("unsupported_explained");
  if (invalidReferences) failures.push("invalid_reference");
  if (missing.length) failures.push("missing_required_evidence");
  if (forbiddenClaimsMade.length) failures.push("forbidden_claim");
  const needsReview: FailureCategory[] = forbiddenClaimsNeedReview.length
    ? ["forbidden_claim"]
    : [];
  return {
    runStateMatches: run.state === expected.expectedRunState,
    labelAcceptable,
    verifiedExplanation: run.validated.some(isVerifiedExplanation),
    unsupportedExplained,
    overclaimsCaughtByValidation: run.findings.filter(
      (f, i) => f.label === "Explained" && run.validated[i]?.label !== "Explained",
    ).length,
    requiredEvidence: {
      required: expected.requiredEvidence.length,
      cited: expected.requiredEvidence.length - missing.length,
      missing,
    },
    invalidReferences,
    forbiddenClaimsMade,
    /** Possible forbidden claims a person must decide; unresolved until then. */
    forbiddenClaimsNeedReview,
    forbiddenClaimNote: expected.forbiddenClaims.includes(ANY_CAUSE)
      ? `"${ANY_CAUSE}" is made by any Explained label, before or after validation. Under other labels, sentences with cause wording are listed for human review and stay unresolved. Other claims are literal text matches. A reworded claim needs human review.`
      : "Literal text match; a reworded claim needs human review.",
    causeCorrectness: "requires_review" as const,
    failures,
    /** Categories that are neither failed nor clean until a person decides. */
    needsReview,
  };
}
export type CaseScore = ReturnType<typeof scoreCase>;

/** Runs the rule-based baseline under the case's harness condition. */
export async function baselineRun(c: GroundTruthCase, exception: Exception, data: Dataset) {
  const plain = fixtureRetrieval(data, exception);
  const retrieval =
    c.condition === "retrieval_failure"
      ? failing()
      : c.condition === "tool_limit"
        ? limited(plain, TOOL_LIMIT_CONDITION)
        : plain;
  const b = await baselineFor(data, exception, retrieval, plain);
  const finding: Finding = {
    exceptionId: exception.id,
    label: b.label,
    explanation: b.explanation,
    evidence: b.evidence,
    nextStep: "",
    referenceStatus: "valid",
    supportStatus: b.supportStatus,
  };
  const run: CaseRun = {
    state: b.state,
    error: b.state === "completed" ? null : "unavailable",
    findings: [finding],
    validated: [finding],
  };
  return { run, label: b.label, explanation: b.explanation };
}

export interface ModelOptions {
  client: ModelClient;
  model: string;
  effort: Effort;
  maxTokens: number;
  now?: () => number;
}

/** Runs the real investigator once under the case's harness condition. */
export async function modelRun(
  c: GroundTruthCase,
  exception: Exception,
  data: Dataset,
  options: ModelOptions,
) {
  const now = options.now ?? Date.now;
  const plain = fixtureRetrieval(data, exception);
  const requests: RequestTelemetry[] = [];
  const investigator = createRealInvestigator({
    client: options.client,
    model: options.model,
    effort: options.effort,
    maxTokens: options.maxTokens,
    retrievalFor: () => (c.condition === "retrieval_failure" ? failing() : plain),
    toolLimit: c.condition === "tool_limit" ? TOOL_LIMIT_CONDITION : undefined,
    now,
    onRequest: (t) => requests.push(t),
  });
  const started = now();
  const input: InvestigationInput = {
    exception,
    generation: 0,
    acceptedAt: new Date(started).toISOString(),
    deadlineAt: new Date(started + RUN_MS).toISOString(),
  };
  const result = await investigator.investigate(input, AbortSignal.timeout(RUN_MS));
  // Validation reads the application-scoped records, not the harness view.
  const validated = await Promise.all(
    result.findings.map((f) => validateFinding(f, exception, plain)),
  );
  const totalMs = now() - started;
  const inputTokens = requests.reduce((a, r) => a + r.inputTokens, 0);
  const outputTokens = requests.reduce((a, r) => a + r.outputTokens, 0);
  const run: CaseRun = {
    state: result.state,
    error: result.error,
    findings: result.findings,
    validated,
  };
  return {
    run,
    telemetry: {
      servedModels: [...new Set(requests.map((r) => r.model))],
      toolExecutions: result.toolExecutions,
      modelRequests: result.modelRequests,
      totalMsIncludingValidation: totalMs,
      stopReasons: requests.map((r) => r.stopReason),
      requestLatencyMs: requests.map((r) => r.latencyMs),
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(options.model, inputTokens, outputTokens),
    },
  };
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number) {
  const price = PRICES[model];
  return price
    ? Number(((inputTokens * price.input + outputTokens * price.output) / 1e6).toFixed(4))
    : null;
}

function casesFor(split: Split, caseIds?: string[], final = false) {
  // Every entry point goes through here, so held-out stays unscored without
  // explicit final confirmation, for the model and the baseline alike.
  if (split === "held-out" && !final) throw new Error(HELD_OUT_REFUSAL);
  const truth = loadGroundTruth();
  const pool = split === "development" ? truth.development.cases : truth.heldOut.cases;
  if (caseIds?.length) {
    const unknown = caseIds.filter((id) => !pool.some((c) => c.id === id));
    if (unknown.length) throw new Error(`Unknown ${split} case: ${unknown.join(", ")}`);
  }
  return {
    version: truth.version,
    cases: caseIds?.length ? pool.filter((c) => caseIds.includes(c.id)) : pool,
  };
}

function exceptionFor(c: GroundTruthCase, data: Dataset) {
  const exception = detect(data).find((e) => e.id === c.exceptionId);
  if (!exception) throw new Error(`Expected exception was not detected: ${c.id}`);
  return exception;
}

type Scored = { score: CaseScore };
function aggregate(rows: Scored[]) {
  const failureCounts: Partial<Record<FailureCategory, number>> = {};
  for (const r of rows)
    for (const f of r.score.failures) failureCounts[f] = (failureCounts[f] ?? 0) + 1;
  const required = rows.reduce((a, r) => a + r.score.requiredEvidence.required, 0);
  const cited = rows.reduce((a, r) => a + r.score.requiredEvidence.cited, 0);
  return {
    cases: rows.length,
    runStateMatches: rows.filter((r) => r.score.runStateMatches).length,
    labelAcceptable: rows.filter((r) => r.score.labelAcceptable).length,
    verifiedExplanations: rows.filter((r) => r.score.verifiedExplanation).length,
    // Target: zero (EVAL-01).
    unsupportedExplained: rows.reduce((a, r) => a + r.score.unsupportedExplained, 0),
    overclaimsCaughtByValidation: rows.reduce(
      (a, r) => a + r.score.overclaimsCaughtByValidation,
      0,
    ),
    requiredEvidenceCited: { cited, required },
    invalidReferences: rows.reduce((a, r) => a + r.score.invalidReferences, 0),
    forbiddenClaimsMade: rows.reduce((a, r) => a + r.score.forbiddenClaimsMade.length, 0),
    forbiddenClaimsNeedReview: rows.reduce(
      (a, r) => a + r.score.forbiddenClaimsNeedReview.length,
      0,
    ),
    failureCounts,
    causeCorrectness: "requires_review" as const,
  };
}

const REVIEW_TIME = {
  status: "unavailable" as const,
  note: "No analyst has been timed. See the review-time protocol in evals/README.md; no improvement is claimed.",
};

/** Baseline only: no model call, no credentials. */
export async function evaluateBaseline(
  split: Split,
  options: { caseIds?: string[]; final?: boolean } = {},
) {
  const { version, cases } = casesFor(split, options.caseIds, options.final);
  const rows = [];
  for (const c of cases) {
    const data = datasetFor(c);
    const b = await baselineRun(c, exceptionFor(c, data), data);
    rows.push({
      caseId: c.id,
      condition: c.condition,
      fixture: fixtureVersionFor(c),
      expected: { runState: c.expectedRunState, acceptableLabels: c.acceptableLabels },
      state: b.run.state,
      label: b.label,
      explanation: b.explanation,
      evidence: b.run.findings[0].evidence,
      score: scoreCase(c, b.run),
    });
  }
  return {
    version: EVALUATOR_VERSION,
    mode: "baseline-only" as const,
    split,
    versions: { groundTruth: version, baseline: BASELINE_VERSION },
    modelRequests: 0,
    summary: aggregate(rows),
    cases: rows,
    reviewTime: REVIEW_TIME,
    note: "Small synthetic case set; not a reliability or generalization claim.",
  };
}

/** One case: the model and the baseline on identical records, both scored. */
async function evaluateCase(c: GroundTruthCase, options: ModelOptions) {
  const data = datasetFor(c);
  const exception = exceptionFor(c, data);
  const m = await modelRun(c, exception, data, options);
  const b = await baselineRun(c, exception, data);
  const common = {
    caseId: c.id,
    condition: c.condition,
    fixture: fixtureVersionFor(c),
    expected: {
      runState: c.expectedRunState,
      acceptableLabels: c.acceptableLabels,
      cause: c.expectedCause,
    },
  };
  return {
    model: {
      ...common,
      state: m.run.state,
      error: m.run.error,
      ...m.telemetry,
      modelFindings: m.run.findings,
      validatedFindings: m.run.validated,
      score: scoreCase(c, m.run),
    },
    baseline: {
      ...common,
      state: b.run.state,
      label: b.label,
      explanation: b.explanation,
      evidence: b.run.findings[0].evidence,
      score: scoreCase(c, b.run),
    },
  };
}

/** Model and baseline on identical records. Makes model calls via `client`. */
export async function evaluate(
  split: Split,
  options: Partial<ModelOptions> & { client: ModelClient; caseIds?: string[]; final?: boolean },
) {
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? "medium";
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const { version, cases } = casesFor(split, options.caseIds, options.final);
  const rows: Awaited<ReturnType<typeof evaluateCase>>[] = [];
  // Sequential: one investigation at a time, like the application.
  for (const c of cases)
    rows.push(
      await evaluateCase(c, { client: options.client, model, effort, maxTokens, now: options.now }),
    );
  const modelRows = rows.map((r) => r.model);
  const baselineRows = rows.map((r) => r.baseline);
  const sum = (k: "inputTokens" | "outputTokens") =>
    modelRows.reduce((a, r) => a + r[k], 0);
  const latencies = modelRows.map((r) => r.totalMsIncludingValidation).sort((a, b) => a - b);
  const costs = modelRows.map((r) => r.estimatedCostUsd);
  return {
    version: EVALUATOR_VERSION,
    mode: "model-and-baseline" as const,
    split,
    versions: {
      groundTruth: version,
      prompt: PROMPT_VERSION,
      baseline: BASELINE_VERSION,
      fixtures: [...new Set(cases.map(fixtureVersionFor))],
    },
    configuration: {
      requestedModel: model,
      servedModels: [...new Set(modelRows.flatMap((r) => r.servedModels))],
      effort,
      maxTokens,
      sdkRetries: 0,
      runBudgetMs: RUN_MS,
      validationReserveMs: VALIDATION_RESERVE_MS,
      toolLimitCondition: TOOL_LIMIT_CONDITION,
    },
    usage: {
      modelRequests: modelRows.reduce((a, r) => a + r.modelRequests, 0),
      toolExecutions: modelRows.reduce((a, r) => a + r.toolExecutions, 0),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      latencyMs: {
        median: latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : null,
        max: latencies.at(-1) ?? null,
      },
      estimatedCostUsd: costs.every((c) => c !== null)
        ? Number(costs.reduce((a, c) => a + (c ?? 0), 0).toFixed(4))
        : null,
      costNote: "List-price estimate from reported tokens; check the Console for billed cost.",
    },
    summary: { model: aggregate(modelRows), baseline: aggregate(baselineRows) },
    model: modelRows,
    baseline: baselineRows,
    reviewTime: REVIEW_TIME,
    hosting:
      "Unverified: runs use local fixture retrieval; no deployment exists yet (DEPLOY-01).",
    note: "One run per case on a small synthetic set; not a reliability or generalization claim.",
  };
}
