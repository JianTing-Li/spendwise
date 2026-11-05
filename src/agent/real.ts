import type { Investigator } from "../investigation";

// The loop is in ./loop and the SDK client in ./client, so stub-mode routes
// importing this module never load the SDK.

/**
 * The application's real-mode entry point until INT-01 (#10) wires
 * `realInvestigatorFromEnv` (./client) to database-scoped retrieval. It fails explicitly
 * rather than calling a model without application-scoped retrieval.
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
