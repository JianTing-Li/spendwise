import Anthropic from "@anthropic-ai/sdk";
import type { Investigator } from "../investigation";
import {
  DEFAULT_MODEL,
  createRealInvestigator,
  type RealInvestigatorOptions,
} from "./loop";

/**
 * Builds the real investigator from server-side configuration. The SDK client
 * reads credentials itself; they never enter prompts, results or logs (INV-12).
 */
export function realInvestigatorFromEnv(
  retrievalFor: RealInvestigatorOptions["retrievalFor"],
  env: Record<string, string | undefined> = process.env,
): Investigator {
  let anthropic: Anthropic | undefined;
  return createRealInvestigator({
    client: {
      // Constructed on first use, so missing credentials surface as an
      // explicit failed/unavailable run instead of a crash at import time.
      create: (params, opts) =>
        (anthropic ??= new Anthropic({ maxRetries: 0 })).messages.create(
          params,
          opts,
        ),
    },
    model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    retrievalFor,
  });
}
