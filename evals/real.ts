/**
 * EVAL-01 real evaluation: the investigator and the rule-based baseline on
 * identical records, scored against evaluator-only expected answers.
 *
 *   npm run eval:real -- --allow-paid [--split development|held-out]
 *     [--case id ...] [--model ID] [--effort medium] [--max-tokens N] > report.json
 *
 * Makes no model call and reads no credentials without --allow-paid and a
 * server-side ANTHROPIC_API_KEY. Held-out cases also need --final: they run
 * once, after the prompt and validator are final, and are never used to tune.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Effort, ModelClient } from "../src/agent/loop";
import { estimateCost, evaluate, splitFrom } from "./evaluate";
import { loadGroundTruth } from "./ground-truth";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** Upper bound for the pre-run estimate: per case, 10 requests of ~6k in / 1.5k out. */
const WORST_CASE_TOKENS = { input: 60_000, output: 15_000 };

function flag(argv: string[], name: string) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const flags = (argv: string[], name: string) =>
  argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));

/** CLI entry. Returns the exit code; makes no call without --allow-paid. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
  makeClient: () => ModelClient,
  write: (text: string) => void = (t) => process.stdout.write(t),
  warn: (text: string) => void = (t) => console.error(t),
) {
  if (!argv.includes("--allow-paid")) {
    warn("Real evaluation requires explicit --allow-paid opt-in. No model call was made.");
    return 1;
  }
  const parsed = splitFrom(argv);
  if ("error" in parsed) {
    warn(`${parsed.error} No model call was made.`);
    return 1;
  }
  const { split, final } = parsed;
  if (!env.ANTHROPIC_API_KEY) {
    warn("ANTHROPIC_API_KEY is not set in the server-side environment. No model call was made.");
    return 1;
  }
  const effort = flag(argv, "--effort");
  if (effort && !EFFORTS.includes(effort)) {
    warn("Unknown --effort value.");
    return 1;
  }
  const maxTokens = flag(argv, "--max-tokens");
  if (maxTokens && !/^[1-9]\d{2,5}$/.test(maxTokens)) {
    warn("--max-tokens must be a whole number between 100 and 999999.");
    return 1;
  }
  const model = flag(argv, "--model") ?? (env.ANTHROPIC_MODEL || undefined);
  const caseIds = flags(argv, "--case");
  try {
    const truth = loadGroundTruth();
    const pool = split === "development" ? truth.development.cases : truth.heldOut.cases;
    const count = caseIds.length || pool.length;
    const ceiling = estimateCost(
      model ?? "claude-opus-5-5",
      WORST_CASE_TOKENS.input * count,
      WORST_CASE_TOKENS.output * count,
    );
    warn(
      `Running ${count} ${split} case(s). Worst-case list-price estimate: ${
        ceiling === null ? "unavailable" : `$${ceiling}`
      }.`,
    );
    const report = await evaluate(split, {
      client: makeClient(),
      caseIds,
      model,
      effort: effort as Effort | undefined,
      maxTokens: maxTokens ? Number(maxTokens) : undefined,
      final,
    });
    write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    // Messages here come from evaluator code, never from the SDK or credentials.
    warn(
      error instanceof Error && !(error instanceof Anthropic.APIError)
        ? error.message
        : "Real evaluation failed.",
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
