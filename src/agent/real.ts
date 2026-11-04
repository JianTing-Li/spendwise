import type { Investigator } from "../investigation";
/** The real loop is Jian's first implementation task. Never fall back to a stub. */
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
