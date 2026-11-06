/**
 * EVAL-01 offline: scores the rule-based baseline against the expected
 * answers. No model call and no credentials.
 *
 *   npm run eval:score-baseline [-- --split development|held-out]
 */
import { evaluateBaseline, type Split } from "./evaluate";

const i = process.argv.indexOf("--split");
const split = (i >= 0 ? process.argv[i + 1] : "development") as Split;
if (split !== "development" && split !== "held-out") {
  console.error("--split must be development or held-out.");
  process.exitCode = 1;
} else
  evaluateBaseline(split)
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch(() => {
      console.error("Baseline scoring failed.");
      process.exitCode = 1;
    });
