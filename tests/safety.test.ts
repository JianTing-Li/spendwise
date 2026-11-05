import { describe, expect, it, vi } from "vitest";
import { Budget } from "../src/investigation/budget";
import { localRequestAllowed } from "../src/server/access";
import { detect } from "../src/domain/finance";
import { injectedDataset } from "../src/fixtures/scenarios";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import { validateFinding } from "../src/agent/validation";
import { realInvestigator } from "../src/agent/real";
import { Dataset, ToolInputs } from "../src/contracts";

describe("INV-06/07/08/12 safety boundaries", () => {
  it("accepts Next.js localhost normalization without accepting a foreign Host", () => {
    const headers = { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100", "content-type": "application/json", "x-spendwise-demo": "1" };
    expect(localRequestAllowed(new Request("http://localhost:3100/api/demo", { method: "POST", headers }), false)).toBe(true);
    expect(localRequestAllowed(new Request("http://localhost:3100/api/demo", { method: "POST", headers: { ...headers, host: "evil.example:3100" } }), false)).toBe(false);
  });
  it("counts failed attempts and enforces the independent request/deadline limits", () => {
    const now = vi.fn(() => 1000);
    const budget = new Budget(2000, now);
    for (let i = 0; i < 8; i++) budget.takeTool();
    expect(() => budget.takeTool()).toThrow("tool_limit");
    for (let i = 0; i < 10; i++) budget.takeModel();
    expect(() => budget.takeModel()).toThrow("model_limit");
    now.mockReturnValue(2000);
    expect(() => budget.check()).toThrow("deadline");
  });
  it("rejects remote origins, missing capabilities, proxy hosts, and hosted mode", () => {
    const request = (origin = "http://127.0.0.1:3000", extra = {}) =>
      new Request("http://127.0.0.1:3000/api/demo", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin,
          "content-type": "application/json",
          "x-spendwise-demo": "1",
          ...extra,
        },
      });
    expect(localRequestAllowed(request(), false)).toBe(true);
    expect(localRequestAllowed(request(), true)).toBe(false);
    expect(localRequestAllowed(request("https://evil.example"), false)).toBe(
      false,
    );
    expect(
      localRequestAllowed(
        request(undefined, { "x-spendwise-demo": "0" }),
        false,
      ),
    ).toBe(false);
    expect(
      localRequestAllowed(
        request(undefined, { "x-forwarded-host": "evil.example" }),
        false,
      ),
    ).toBe(false);
  });
  it("scopes retrieval and refuses to treat valid IDs or model claims as proof", async () => {
    const data = injectedDataset();
    const exception = detect(data).find(
      (e) => e.vendorId === "vendor-renewal",
    )!;
    const tools = fixtureRetrieval(data, exception);
    expect(
      await tools.list_payments({ paymentIds: ["pay-advisory-a"] }),
    ).toEqual([]);
    const candidate = {
      exceptionId: exception.id,
      label: "Explained",
      explanation: "Unsupported claim of approved expense recognition.",
      evidence: [{ type: "payment", id: "pay-renewal-annual" }],
      nextStep: "Review",
      referenceStatus: "valid",
      supportStatus: "supported",
    };
    // A valid payment ID alone does not document the increase.
    expect(await validateFinding(candidate, exception, tools)).toMatchObject({
      label: "Needs Review",
      referenceStatus: "valid",
      supportStatus: "missing",
    });
    expect(
      await validateFinding(
        { ...candidate, evidence: [{ type: "payment", id: "pay-advisory-a" }] },
        exception,
        tools,
      ),
    ).toMatchObject({
      label: "Insufficient Evidence",
      referenceStatus: "invalid",
      supportStatus: "missing",
    });
    expect(() =>
      ToolInputs.list_payments.parse({ sql: "SELECT * FROM secrets" }),
    ).toThrow();
  });
  it("bounds untrusted text and does not silently substitute a real-model failure", async () => {
    const data = injectedDataset();
    data.notes[0].text = "x".repeat(4001);
    expect(() => Dataset.parse(data)).toThrow();
    const exception = detect(injectedDataset())[0];
    expect(
      await realInvestigator.investigate(
        {
          exception,
          generation: 0,
          acceptedAt: "2026-11-01T00:00:00Z",
          deadlineAt: "2026-11-01T00:01:00Z",
        },
        new AbortController().signal,
      ),
    ).toMatchObject({ mode: "real", state: "failed", error: "unavailable" });
  });
});
