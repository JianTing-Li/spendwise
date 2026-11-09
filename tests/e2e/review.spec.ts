import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { DemoState } from "../../src/contracts";

const headers = { Origin: "http://127.0.0.1:3100", "X-Spendwise-Demo": "1" };
let baseline: DemoState;
let injected: DemoState;
const copy = <T,>(value: T): T => structuredClone(value);
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function reset(request: APIRequestContext) {
  expect((await request.post("/api/demo", { headers, data: { action: "reset" } })).status()).toBe(200);
}
test.beforeAll(async ({ request }) => {
  await reset(request);
  baseline = await (await request.get("/api/demo")).json();
  expect((await request.post("/api/demo", { headers, data: { action: "inject", scenarioId: "demo-v1" } })).status()).toBe(200);
  const full: DemoState = await (await request.get("/api/demo")).json();
  const exception = full.exceptions.find(e => e.rule === "payment_increase" && e.vendorId === "vendor-renewal")!;
  expect(exception).toBeTruthy();
  injected = { ...full, exceptions: [exception], runs: full.runs.filter(r => r.exceptionId === exception.id) };
});
test.afterAll(async ({ request }) => { await reset(request); });

async function opened(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Reset demo" })).toBeEnabled();
}

test("keyboard/mobile evidence, verified vs draft labels, and run-specific review survive reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = copy(injected);
  const run = state.runs[0];
  run.mode = "real";
  const finding = run.findings[0];
  finding.label = "Explained";
  finding.referenceStatus = "valid";
  finding.supportStatus = "supported";
  finding.explanation = "Application record checks support the documented cash increase. The business purpose remains a human judgment.";
  state.runs[0].findings.push({ ...copy(finding), label: "Needs Review", supportStatus: "missing", explanation: "The business reason remains unresolved.", evidence: [{ type: "note", id: "missing-note" }] });
  const note = state.dataset.notes.find(n => n.vendorId === state.exceptions[0].vendorId)!;
  note.text = '<img src=x onerror="alert(1)"> Untrusted note text';
  finding.evidence.push({ type: "note", id: note.id });
  // Display the settings stored on the exception, including non-default settings.
  state.exceptions[0].settings.minimumIncreaseCents = 600000;
  state.exceptions[0].settings.minimumPercent = 25;
  let reviews = 0;
  await page.route("**/api/demo", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: state });
    const body = route.request().postDataJSON();
    expect(body).toEqual({ action: "review", runId: run.id });
    expect(run.generation).toBe(state.generation);
    reviews++;
    run.reviewedAt = "2026-11-09T18:00:00.000Z";
    await route.fulfill({ json: { ok: true, generation: state.generation, changed: true } });
  });
  await opened(page);
  const card = page.getByRole("article");
  await expect(card.getByText("Verified record explanation", { exact: true })).toHaveCount(1);
  await expect(card.getByText("Draft · explanation not verified", { exact: true })).toHaveCount(1);
  await expect(card.getByRole("heading", { name: "Unresolved question" })).toBeVisible();
  await expect(card.getByText(/At least \$6,000.00 and 25%/)).toBeVisible();
  await expect(card.getByText("$1,000.00", { exact: true })).toBeVisible();
  await expect(card.getByText("$13,000.00", { exact: true })).toBeVisible();
  await expect(card.getByText(/missing-note — unavailable/)).toBeVisible();
  const citation = card.getByRole("link", { name: `note: ${note.id}` }).first();
  await citation.focus();
  await page.keyboard.press("Enter");
  await expect(card.locator("details[open] .record:focus")).toContainText(note.text);
  await expect(card.getByRole("img")).toHaveCount(0);
  const review = card.getByRole("button", { name: "Mark reviewed", exact: true });
  await review.focus();
  await page.keyboard.press("Space");
  await expect(card.getByRole("button", { name: "Reviewed", exact: true })).toBeDisabled();
  await expect(card.getByText(/Acknowledgment only; explanation support is unchanged/)).toBeVisible();
  await page.reload();
  await expect(card.getByRole("button", { name: "Reviewed", exact: true })).toBeDisabled();
  await expect(card.getByText("Draft · explanation not verified", { exact: true })).toHaveCount(1);
  expect(reviews).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/ui01-evidence-mobile.png", fullPage: true });
});

test("poll pending/running, distinguish incomplete/cancelled/failed, and bound explicit retries", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let state = copy(baseline);
  let injections = 0;
  let retries = 0;
  let readStatus = 200;
  const injection = gate();
  const retry = gate();
  await page.route("**/api/demo", async route => {
    if (route.request().method() === "GET") return route.fulfill(readStatus === 200 ? { json: state } : { status: readStatus, json: { error: "unavailable" } });
    injections++;
    state = copy(injected);
    Object.assign(state.runs[0], { mode: "real", state: "pending", findings: [], toolExecutions: 0, modelRequests: 0 });
    await injection.promise;
    await route.fulfill({ json: { ok: true, generation: state.generation, changed: true } });
  });
  await page.route("**/api/demo/retry", async route => {
    retries++;
    const previous = state.runs.at(-1)!;
    expect(route.request().postDataJSON()).toEqual({ predecessorId: previous.id });
    state.runs.push({ ...copy(previous), id: `${previous.id}:retry`, state: "running", findings: [], error: null });
    if (retries === 1) await retry.promise;
    Object.assign(state.runs.at(-1)!, { state: retries === 1 ? "cancelled" : "failed", error: retries === 1 ? null : "unavailable" });
    await route.fulfill({ json: { ok: true, generation: state.generation, changed: true } });
  });
  try {
    await opened(page);
    await page.getByRole("button", { name: "Simulate new payments" }).click();
    const card = page.getByRole("article");
    await expect(card.getByText("pending", { exact: true })).toBeVisible();
    Object.assign(state.runs[0], { state: "running", toolExecutions: 2, modelRequests: 1 });
    await expect(card.getByText("running", { exact: true })).toBeVisible();
    await expect(card.getByText(/Retrievals 2\/8 · Model requests 1\/10/)).toBeVisible();
    readStatus = 503;
    await expect(page.getByText("Progress updates are unavailable. Reload to check current run states.")).toBeVisible();
    readStatus = 200;
    await page.getByRole("button", { name: "Reload", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(injections).toBe(1);
    Object.assign(state.runs[0], { state: "incomplete", error: "tool_limit" });
    injection.release();
    await expect(card.getByText("incomplete", { exact: true })).toBeVisible();
    const retryButton = card.getByRole("button", { name: "Retry investigation (1/3 attempts used)" });
    await expect(retryButton).toBeEnabled();
    // Two clicks in one task exercise the ref guard before a disabled render.
    await retryButton.evaluate(button => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await expect(card.getByText("running", { exact: true })).toBeVisible();
    expect(retries).toBe(1);
    retry.release();
    await expect(card.getByText("cancelled", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Retry investigation (2/3 attempts used)" }).focus();
    await page.keyboard.press("Space");
    await expect(card.getByText("failed", { exact: true })).toBeVisible();
    await expect(card.getByText("Three attempts used. Reset the demo to start again.")).toBeVisible();
    await expect(card.getByRole("button", { name: /Retry investigation/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);
    expect(retries).toBe(2);
    await page.reload();
    await card.getByText("Attempt history", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(card.getByText("incomplete", { exact: true })).toBeVisible();
    await expect(card.getByText("cancelled", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/ui01-recovery.png", fullPage: true });
  } finally { injection.release(); retry.release(); }
});

test("reset during execution rejects late read and mutation responses", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let state = copy(baseline);
  const injection = gate();
  const staleRead = gate();
  const readDelivered = gate();
  const mutationDelivered = gate();
  let holdRead = false;
  let held = false;
  await page.route("**/api/demo", async route => {
    if (route.request().method() === "GET") {
      const snapshot = copy(state);
      const delayed = holdRead;
      if (delayed) { held = true; await staleRead.promise; }
      await route.fulfill({ json: snapshot });
      if (delayed) readDelivered.release();
      return;
    }
    if (route.request().postDataJSON().action === "inject") {
      state = copy(injected);
      state.runs[0].reviewedAt = "2026-11-09T18:00:00.000Z";
      await injection.promise;
      await route.fulfill({ json: { ok: true, generation: injected.generation, changed: true } });
      mutationDelivered.release();
      return;
    }
    holdRead = false;
    state = { ...copy(baseline), generation: injected.generation + 1 };
    return route.fulfill({ json: { ok: true, generation: state.generation, changed: true } });
  });
  try {
    await opened(page);
    await page.getByRole("button", { name: "Simulate new payments" }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    holdRead = true;
    await expect.poll(() => held).toBe(true);
    await page.getByRole("button", { name: "Reset demo" }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("Baseline ready")).toBeVisible();
    staleRead.release();
    injection.release();
    await Promise.all([readDelivered.promise, mutationDelivered.promise]);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(/Acknowledgment only/)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Baseline ready")).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(/Acknowledgment only/)).toHaveCount(0);
  } finally { injection.release(); staleRead.release(); }
});

test("read and mutation access denial hide records and require an authorized reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let status = 401;
  let posts = 0;
  await page.route("**/api/demo", async route => {
    if (route.request().method() === "POST") { posts++; return route.fulfill({ status: 403, json: { error: "unauthorized" } }); }
    return route.fulfill(status === 200 ? { json: injected } : { status, json: { error: "unauthorized" } });
  });
  await page.goto("/");
  await expect(page.locator("main").getByRole("alert")).toContainText("Sign in again");
  await expect(page.getByRole("button", { name: "Simulate new payments" })).toBeDisabled();
  status = 403;
  await page.getByRole("button", { name: "Reload", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main").getByRole("alert")).toContainText("Access denied");
  status = 200;
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Access denied");
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(posts).toBe(1);
});

test("stub, incomplete, invalid-reference and unresolved findings never acquire a verified badge", async ({ page }) => {
  const state = copy(injected);
  const run = state.runs[0];
  const finding = run.findings[0];
  run.reviewedAt = "2026-11-09T18:00:00.000Z";
  finding.label = "Explained";
  finding.referenceStatus = "valid";
  finding.supportStatus = "supported";
  await page.route("**/api/demo", route => route.fulfill({ json: state }));
  for (const variant of [
    { mode: "stub", state: "completed", referenceStatus: "valid", label: "Explained" },
    { mode: "real", state: "incomplete", referenceStatus: "valid", label: "Explained" },
    { mode: "real", state: "completed", referenceStatus: "invalid", label: "Explained" },
    { mode: "real", state: "completed", referenceStatus: "valid", label: "Needs Review" },
  ] as const) {
    Object.assign(run, { mode: variant.mode, state: variant.state });
    Object.assign(finding, { referenceStatus: variant.referenceStatus, label: variant.label });
    await opened(page);
    const card = page.getByRole("article");
    await expect(card.getByText("Draft · explanation not verified", { exact: true })).toBeVisible();
    await expect(card.getByText("Verified record explanation", { exact: true })).toHaveCount(0);
  }
});
