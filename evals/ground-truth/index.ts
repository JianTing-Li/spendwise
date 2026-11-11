// Evaluator-only. Lint rejects imports of this directory from src/ and the baseline (INV-11).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { EvidenceRef, Finding, RunState } from "../../src/contracts";

const Label = Finding.shape.label;
export const GroundTruthCase = z
  .object({
    id: z.string().min(1),
    datasetId: z.enum(["demo-v1", "eval-dev-v1", "eval-heldout-v1"]),
    exceptionId: z.string().min(1),
    // Harness condition the evaluator applies; "none" means the records alone.
    condition: z.enum(["none", "retrieval_failure", "tool_limit"]),
    expectedRunState: RunState,
    expectedLabel: Label,
    acceptableLabels: z.array(Label).min(1),
    allowNoFindings: z.boolean().optional(),
    expectedCause: z.string().min(1),
    requiredEvidence: z.array(EvidenceRef),
    amounts: z
      .object({
        differenceCents: z.number().int().optional(),
        possibleExcessCents: z.number().int().optional(),
      })
      .strict(),
    forbiddenClaims: z.array(z.string().min(1)),
  })
  .strict()
  .refine((c) => c.acceptableLabels.includes(c.expectedLabel), {
    message: "expectedLabel must be one of acceptableLabels",
  });
export type GroundTruthCase = z.infer<typeof GroundTruthCase>;
const GroundTruthFile = z
  .object({
    version: z.literal("ground-truth-v3"),
    split: z.enum(["development", "held-out"]),
    cases: z.array(GroundTruthCase),
  })
  .strict();

function load(file: string, split: "development" | "held-out") {
  const parsed = GroundTruthFile.parse(
    JSON.parse(
      readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"),
    ),
  );
  if (parsed.split !== split) throw new Error(`${file} is not ${split}`);
  return parsed;
}

export function loadGroundTruth() {
  const development = load("./development.json", "development");
  const heldOut = load("./held-out.json", "held-out");
  const all = [...development.cases, ...heldOut.cases];
  const keys = all.map((c) => `${c.datasetId}|${c.exceptionId}|${c.condition}`);
  if (new Set(all.map((c) => c.id)).size !== all.length)
    throw new Error("Duplicate ground-truth case ID");
  if (new Set(keys).size !== keys.length)
    throw new Error("Duplicate ground-truth exception/condition");
  return { version: development.version, development, heldOut, all };
}
