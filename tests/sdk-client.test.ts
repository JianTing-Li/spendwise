import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { call, draft, message } from "./helpers/int01-model";

// The SDK is replaced, so no network request or real key is possible here.
const sdk = vi.hoisted(() => ({ construct: vi.fn(), create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: sdk.create };
    constructor(options: unknown) { sdk.construct(options); }
  },
}));

import { anthropicModelClient } from "../src/agent/client";
import { Store } from "../src/server/db/store";
import { runPending } from "../src/server/investigation/run";

beforeEach(() => {
  sdk.construct.mockClear();
  sdk.create.mockReset();
  sdk.create.mockImplementation(async () => message([call("submit_findings", { findings: [draft()] })]));
});
afterEach(() => { vi.unstubAllEnvs(); });

it("builds one zero-retry SDK client, on first use", async () => {
  const client = anthropicModelClient();
  expect(sdk.construct).not.toHaveBeenCalled();
  const params = {} as Parameters<typeof client.create>[0];
  const options = { signal: new AbortController().signal, timeout: 1, maxRetries: 0 as const };
  await client.create(params, options);
  await client.create(params, options);
  expect(sdk.construct.mock.calls).toEqual([[{ maxRetries: 0 }]]);
  expect(sdk.create).toHaveBeenCalledTimes(2);
});

it("the durable runtime builds its model client through that factory when a key is configured", async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-only-not-a-credential");
  const db = new PGlite();
  try {
    const store = new Store(db);
    await store.initialize();
    await store.inject();
    await runPending(store);
    const { runs } = await store.state();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every(run => run.mode === "real" && run.modelRequests === 1)).toBe(true);
    expect(sdk.construct.mock.calls).toEqual(runs.map(() => [{ maxRetries: 0 }]));
  } finally { await db.close(); }
});
