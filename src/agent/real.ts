import type { Investigator } from "../investigation";

// The loop is in ./loop and the SDK client in ./client, so stub-mode routes
// importing this module never load the SDK.

/**
 * The fail-closed real-mode investigator, used by the durable runtime when no
 * API key is configured. It reports unavailable and never calls a model or
 * falls back to the stub (INV-09).
 */
export const realInvestigator: Investigator = {
  async investigate() {
    return {
      mode: "real",
      state: "failed",
      findings: [],
      error: "unavailable",
      toolExecutions: 0,
      modelRequests: 0,
    };
  },
};
