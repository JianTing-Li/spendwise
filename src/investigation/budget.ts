import type { z } from "zod";
import type { ErrorCode } from "../contracts";
export class RunError extends Error {
  constructor(public readonly code: z.infer<typeof ErrorCode>) {
    super(code);
  }
}
export class Budget {
  toolExecutions = 0;
  modelRequests = 0;
  constructor(
    readonly deadline: number,
    readonly now: () => number = Date.now,
  ) {}
  check() {
    if (this.now() >= this.deadline) throw new RunError("deadline");
  }
  // Count before execution: failures and explicit retries consume budget too.
  takeTool() {
    this.check();
    if (this.toolExecutions >= 8) throw new RunError("tool_limit");
    this.toolExecutions++;
  }
  takeModel() {
    this.check();
    if (this.modelRequests >= 10) throw new RunError("model_limit");
    this.modelRequests++;
  }
}
