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
          explanation:
            "Stub response: the application detected this exception. No AI investigation or business-cause verification has been performed.",
          evidence: input.exception.paymentIds.map((id) => ({
            type: "payment" as const,
            id,
          })),
          nextStep:
            "Inspect the payments, linked invoices, and notes. Determine whether further investigation is needed.",
          referenceStatus: "unchecked",
          supportStatus: "unverified",
        },
      ],
    };
  },
};
