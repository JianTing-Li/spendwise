import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";
export default defineConfig([
  ...next,
  ...ts,
  {
    // INV-11: expected answers are evaluator-only. Runtime, agent, retrieval,
    // prompts and the rule-based baseline must never import them.
    files: ["src/**", "evals/baseline.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ground-truth", "**/ground-truth/**"],
              message:
                "evals/ground-truth is evaluator-only (INV-11); never import it into runtime, agent, retrieval, prompt or baseline code.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "next-env.d.ts",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
