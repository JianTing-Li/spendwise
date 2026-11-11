import type { Investigator } from "../../investigation";
export const stubInvestigator: Investigator = {
  async investigate(input, signal) {
    if (signal.aborted)
      return {
        mode: "stub",
        state: "cancelled",
        findings: [],
        error: "deadline",
        toolExecutions: 0,
        modelRequests: 0,
      };
    return {
      mode: "stub",
      state: "completed",
      error: null,
      toolExecutions: 0,
      modelRequests: 0,
      findings: [
        {
          exceptionId: input.exception.id,
          label: "Needs Review",
          summary: "Placeholder: no AI investigation ran in this mode.",
          explanation:
            "- The application detected this flag.\n- No AI investigation or cause check was performed.",
          evidence: input.exception.paymentIds.map((id) => ({
            type: "payment" as const,
            id,
          })),
          nextStep:
            "Open the evidence below and decide whether to follow up.",
          referenceStatus: "unchecked",
          supportStatus: "unverified",
        },
      ],
    };
  },
};
