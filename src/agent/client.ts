import Anthropic from "@anthropic-ai/sdk";
import type { Investigator } from "../investigation";
import {
  DEFAULT_MODEL,
  createRealInvestigator,
  type ModelClient,
  type RealInvestigatorOptions,
} from "./loop";

/**
 * The application's one SDK client setup, with SDK retries at zero (INV-08).
 * The SDK reads credentials itself; they never enter prompts, results or logs
 * (INV-12). Constructed on first use, so missing credentials surface as an
 * explicit failed/unavailable run instead of a crash at import time.
 */
export function anthropicModelClient(): ModelClient {
  let anthropic: Anthropic | undefined;
  return {
    create: (params, opts) =>
      (anthropic ??= new Anthropic({ maxRetries: 0 })).messages.create(
        params,
        opts,
      ),
  };
}

/** Builds the real investigator from server-side configuration. */
export function realInvestigatorFromEnv(
  retrievalFor: RealInvestigatorOptions["retrievalFor"],
  env: Record<string, string | undefined> = process.env,
): Investigator {
  return createRealInvestigator({
    client: anthropicModelClient(),
    model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    retrievalFor,
  });
}
