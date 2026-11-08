/**
 * EVAL-01 offline: scores the rule-based baseline against the expected
 * answers. No model call and no credentials. Held-out cases also need
 * --final, the same guard as eval:real: they are scored once, after tuning.
 *
 *   npm run eval:score-baseline [-- --split development|held-out [--final]]
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { evaluateBaseline, splitFrom } from "./evaluate";

/** CLI entry. Returns the exit code; scores nothing when the guard refuses. */
export async function main(
  argv: string[],
  score: typeof evaluateBaseline = evaluateBaseline,
  write: (text: string) => void = (t) => process.stdout.write(t),
  warn: (text: string) => void = (t) => console.error(t),
) {
  const parsed = splitFrom(argv);
  if ("error" in parsed) {
    warn(`${parsed.error} Nothing was scored.`);
    return 1;
  }
  try {
    const report = await score(parsed.split, { final: parsed.final });
    write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch {
    warn("Baseline scoring failed.");
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
