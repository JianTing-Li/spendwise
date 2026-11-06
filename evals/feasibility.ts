/**
 * FEAS-01: one opted-in, real investigation of one synthetic development case,
 * compared with its prewritten expected result and the rule-based baseline.
 *
 *   npm run eval:feasibility -- --allow-paid [--case renewal] [--model ID]
 *     [--effort low|medium|high] [--max-tokens N] > report.json
 *
 * Without --allow-paid it makes no model call and reads no credentials. The
 * report contains no credentials. One run is an example, not a reliability
 * claim. Held-out cases are refused: they run once, after tuning ends.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
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
import { detect } from "../src/domain/finance";
import { FIXTURE_VERSION, injectedDataset } from "../src/fixtures/scenarios";
import {
  EVALUATION_FIXTURE_VERSION,
  developmentDataset,
} from "../src/fixtures/evaluation";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import type { Dataset, Finding, InvestigationInput } from "../src/contracts";
import { loadGroundTruth, type GroundTruthCase } from "./ground-truth";
import { BASELINE_VERSION, baselineFor } from "./baseline";

export const FEASIBILITY_VERSION = "feasibility-v2";
const RUN_MS = 60_000;

/** List prices per million tokens (USD), for an estimate only; no cache discounts. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export interface FeasibilityOptions {
  client: ModelClient;
  caseId?: string;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  now?: () => number;
}

function datasetFor(c: GroundTruthCase): Dataset {
  if (c.datasetId === "demo-v1") return injectedDataset();
  if (c.datasetId === "eval-dev-v1") return developmentDataset;
  throw new Error("Held-out cases are not available to the feasibility check.");
}

function developmentCase(caseId: string) {
  const truth = loadGroundTruth();
  if (truth.heldOut.cases.some((c) => c.id === caseId))
    throw new Error("Held-out cases are not available to the feasibility check.");
  const found = truth.development.cases.find((c) => c.id === caseId);
  if (!found) throw new Error(`Unknown development case: ${caseId}`);
  if (found.condition !== "none")
    throw new Error("The feasibility check runs records-only cases (condition none).");
  return { version: truth.version, expected: found };
}

const cited = (findings: Finding[]) =>
  new Set(findings.flatMap((f) => f.evidence.map((e) => `${e.type}:${e.id}`)));

/** Forbidden claims the model's own wording makes, case-insensitively. */
const claimsMade = (findings: Finding[], forbidden: string[]) =>
  forbidden.filter((claim) =>
    findings.some((f) =>
      `${f.explanation}\n${f.nextStep}`.toLowerCase().includes(claim.toLowerCase()),
    ),
  );

export async function runFeasibility(options: FeasibilityOptions) {
  const now = options.now ?? Date.now;
  const caseId = options.caseId ?? "renewal";
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? "medium";
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const { version: groundTruthVersion, expected } = developmentCase(caseId);
  const data = datasetFor(expected);
  const exception = detect(data).find((e) => e.id === expected.exceptionId);
  if (!exception) throw new Error("Expected exception was not detected.");
  const retrieval = fixtureRetrieval(data, exception);

  const requests: RequestTelemetry[] = [];
  const investigator = createRealInvestigator({
    client: options.client,
    model,
    effort,
    maxTokens,
    retrievalFor: () => retrieval,
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
  const result = await investigator.investigate(
    input,
    AbortSignal.timeout(RUN_MS),
  );
  const investigatedMs = now() - started;
  const validated = await Promise.all(
    result.findings.map((f) => validateFinding(f, exception, retrieval)),
  );
  const totalMs = now() - started;
  const baseline = await baselineFor(data, exception);

  const labels = validated.map((f) => f.label);
  const citedRefs = cited(result.findings);
  const inputTokens = requests.reduce((a, r) => a + r.inputTokens, 0);
  const outputTokens = requests.reduce((a, r) => a + r.outputTokens, 0);
  const price = PRICES[model];
  return {
    version: FEASIBILITY_VERSION,
    caseId,
    versions: {
      fixture:
        expected.datasetId === "demo-v1"
          ? FIXTURE_VERSION
          : `${expected.datasetId} (${EVALUATION_FIXTURE_VERSION})`,
      groundTruth: groundTruthVersion,
      prompt: PROMPT_VERSION,
    },
    configuration: {
      requestedModel: model,
      servedModels: [...new Set(requests.map((r) => r.model))],
      effort,
      maxTokens,
      sdkRetries: 0,
      runBudgetMs: RUN_MS,
      validationReserveMs: VALIDATION_RESERVE_MS,
    },
    run: {
      state: result.state,
      error: result.error,
      toolExecutions: result.toolExecutions,
      modelRequests: result.modelRequests,
      investigationMs: investigatedMs,
      totalMsIncludingValidation: totalMs,
      stopReasons: requests.map((r) => r.stopReason),
      requestLatencyMs: requests.map((r) => r.latencyMs),
    },
    usage: {
      inputTokens,
      outputTokens,
      estimatedCostUsd: price
        ? Number(
            ((inputTokens * price.input + outputTokens * price.output) / 1e6).toFixed(4),
          )
        : null,
      costNote: price
        ? "List-price estimate from reported tokens; check the Console for billed cost."
        : "No list price recorded for this model; cost unavailable.",
    },
    modelFindings: result.findings,
    validatedFindings: validated,
    comparison: {
      runState: {
        expected: expected.expectedRunState,
        actual: result.state,
        matches: result.state === expected.expectedRunState,
      },
      label: {
        expected: expected.expectedLabel,
        acceptable: expected.acceptableLabels,
        model: result.findings.map((f) => f.label),
        validated: labels,
        validatedAcceptable:
          labels.length > 0 &&
          labels.every((l) => expected.acceptableLabels.includes(l)),
      },
      // The records support an Explained label. This does not show the model
      // identified the right cause: a supported finding's explanation is
      // written by the application, not the model.
      recordsSupportExplained: validated.some(isVerifiedExplanation),
      cause: {
        expected: expected.expectedCause,
        modelExplanations: result.findings.map((f) => f.explanation),
        explanationReplacedByApplication: validated.map(
          (f, i) => f.explanation !== result.findings[i].explanation,
        ),
        correctness: "requires_review" as const,
        note: "Whether the model's own explanation states the expected cause is a human judgment; compare modelExplanations with the expected cause.",
      },
      requiredEvidenceMissing: expected.requiredEvidence
        .map((e) => `${e.type}:${e.id}`)
        .filter((key) => !citedRefs.has(key)),
      forbiddenClaimsMade: claimsMade(result.findings, expected.forbiddenClaims),
      baseline: {
        version: BASELINE_VERSION,
        label: baseline.label,
        explanation: baseline.explanation,
        labelAcceptable: expected.acceptableLabels.includes(baseline.label),
      },
    },
    hosting:
      "Unverified: no deployment target is chosen (DEPLOY-01 is on hold), so the 60-second budget has not been checked against a host's limits.",
    note: "One run is an example, not a reliability claim.",
  };
}

function flag(argv: string[], name: string) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** CLI entry. Returns the exit code; makes no call without --allow-paid. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
  makeClient: () => ModelClient,
  write: (text: string) => void = (t) => process.stdout.write(t),
  warn: (text: string) => void = (t) => console.error(t),
) {
  if (!argv.includes("--allow-paid")) {
    warn("Feasibility check requires explicit --allow-paid opt-in. No model call was made.");
    return 1;
  }
  if (!env.ANTHROPIC_API_KEY) {
    warn("ANTHROPIC_API_KEY is not set in the server-side environment. No model call was made.");
    return 1;
  }
  const effort = flag(argv, "--effort");
  if (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    warn("Unknown --effort value.");
    return 1;
  }
  const maxTokens = flag(argv, "--max-tokens");
  if (maxTokens && !/^[1-9]\d{2,5}$/.test(maxTokens)) {
    warn("--max-tokens must be a whole number between 100 and 999999.");
    return 1;
  }
  try {
    const report = await runFeasibility({
      client: makeClient(),
      caseId: flag(argv, "--case"),
      model: flag(argv, "--model") ?? (env.ANTHROPIC_MODEL || undefined),
      effort: effort as Effort | undefined,
      maxTokens: maxTokens ? Number(maxTokens) : undefined,
    });
    write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    // Messages here come from this file, never from the SDK or credentials.
    warn(
      error instanceof Error && !(error instanceof Anthropic.APIError)
        ? error.message
        : "Feasibility check failed.",
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2), process.env, () => {
    const anthropic = new Anthropic({ maxRetries: 0 });
    return { create: (params, opts) => anthropic.messages.create(params, opts) };
  }).then((code) => {
    process.exitCode = code;
  });
