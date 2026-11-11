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

test("keyboard/mobile evidence, verified vs draft labels, safe notes and run-specific review survive reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = copy(injected);
  const run = state.runs[0];
  run.mode = "real";
  const finding = run.findings[0];
  finding.label = "Explained";
  finding.referenceStatus = "valid";
  finding.supportStatus = "supported";
  finding.summary = "The $12,000 increase is paid against invoice NS-2026.";
  finding.explanation = "- $12,000 paid Oct 20 pays invoice NS-2026 in full.\n- Together these cover the $12,000 increase over September.";
  delete finding.supportNote;
  state.runs[0].findings.push({ ...copy(finding), summary: "The business reason is unresolved.", label: "Needs Review", supportStatus: "missing", supportNote: "No cited invoice matches the October payments.", explanation: "The business reason remains unresolved.", evidence: [{ type: "note", id: "missing-note" }] });
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
  const card = page.getByRole("article", { name: "Northstar POS Cloud payment increase" });
  await expect(card.getByText("Checked against the records", { exact: true })).toHaveCount(1);
  await expect(card.getByText("Not verified: No cited invoice matches the October payments.", { exact: true })).toHaveCount(1);
  await expect(card.getByText("Also noted · Needs Review")).toBeVisible();
  // A mixed run is not "Explained" as a whole.
  await expect(card.locator(".flag-top .badge")).toHaveText("Needs review");
  await expect(card.getByText(/increases over \$6,000 and 25%/)).toBeVisible();
  await expect(card.getByText(/\$1,000 in September → \$13,000 in October/)).toBeVisible();
  await expect(card.getByText(/1 cited record isn't available/)).toBeVisible();
  const chip = card.getByRole("button", { name: /^Note · / }).first();
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator(".record")).toContainText(note.text);
  await expect(card.getByRole("img")).toHaveCount(0);
  const review = card.getByRole("button", { name: "Mark reviewed", exact: true });
  await review.focus();
  await page.keyboard.press("Space");
  await expect(card.getByText(/✓ Reviewed/)).toBeVisible();
  await expect(card.getByRole("status", { name: "Investigation status" })).toBeFocused();
  await expect(card.getByText(/doesn't approve or pay anything/)).toBeVisible();
  await page.reload();
  await expect(card.getByText(/✓ Reviewed/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);
  await expect(card.getByText("Not verified: No cited invoice matches the October payments.", { exact: true })).toHaveCount(1);
  expect(reviews).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/ui05-evidence-mobile.png", fullPage: true });
});

test("live progress shows plain steps from recorded lookups, never model text", async ({ page }) => {
  const state = copy(injected);
  const run = state.runs[0];
  Object.assign(run, { mode: "real", state: "running", findings: [], toolExecutions: 3, modelRequests: 2, activity: [
    { tool: "get_payment_summary", ids: [] },
    { tool: "list_payments", ids: ["pay-renewal-annual"] },
    { tool: "get_invoices", ids: ["inv-renewal"] },
  ] });
  await page.route("**/api/demo", route => route.fulfill({ json: state }));
  await opened(page);
  const progress = page.getByRole("status", { name: "Investigation progress" });
  await expect(progress).toContainText("Checked September and October totals");
  await expect(progress).toContainText("Looked up the Oct 20 $12,000 payment");
  await expect(progress).toContainText("Read invoice NS-2026");
  await expect(progress).toContainText("Deciding what to check next…");
  await expect(progress).toContainText("3/8 lookups");
  await expect(page.locator(".banner")).toContainText("Investigating 1 flag");
  await expect(page.locator(".vendor-row .badge")).toHaveText("Investigating");
  run.activity.push({ tool: "submit_findings", ids: [] });
  await expect(progress).toContainText("Checking the answer against the records…");
  await page.screenshot({ path: "test-results/ui05-progress.png", fullPage: true });
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
    Object.assign(state.runs[0], { mode: "real", state: "pending", findings: [], toolExecutions: 0, modelRequests: 0, activity: [] });
    await injection.promise;
    await route.fulfill({ json: { ok: true, generation: state.generation, changed: true } });
  });
  await page.route("**/api/demo/retry", async route => {
    retries++;
    const previous = state.runs.at(-1)!;
    expect(route.request().postDataJSON()).toEqual({ predecessorId: previous.id });
    state.runs.push({ ...copy(previous), id: `${previous.id}:retry`, state: "running", findings: [], error: null, activity: [] });
    if (retries === 1) await retry.promise;
    Object.assign(state.runs.at(-1)!, { state: retries === 1 ? "cancelled" : "failed", error: retries === 1 ? null : "unavailable" });
    await route.fulfill({ json: { ok: true, generation: state.generation, changed: true } });
  });
  try {
    await opened(page);
    await page.getByRole("button", { name: "Load October payments" }).click();
    const card = page.getByRole("article");
    await expect(card.getByText("Waiting to start…")).toBeVisible();
    Object.assign(state.runs[0], { state: "running", toolExecutions: 2, modelRequests: 1 });
    await expect(card.getByText("Starting the investigation…")).toBeVisible();
    await expect(card.getByText(/2\/8 lookups/)).toBeVisible();
    readStatus = 503;
    await expect(page.locator("main").getByRole("alert")).toContainText("Demo unavailable");
    readStatus = 200;
    await page.getByRole("button", { name: "Reload", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(injections).toBe(1);
    Object.assign(state.runs[0], { state: "incomplete", error: "tool_limit" });
    injection.release();
    await expect(card.getByText(/It used all 8 lookups before finishing/)).toBeVisible();
    const retryButton = card.getByRole("button", { name: "Try again (1 of 3 used)" });
    await expect(retryButton).toBeEnabled();
    await retryButton.focus();
    // Two clicks in one task exercise the ref guard before a disabled render.
    await retryButton.evaluate(button => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await expect(card.getByText("Starting the investigation…")).toBeVisible();
    await expect(card.getByRole("status", { name: "Investigation status" })).toBeFocused();
    expect(retries).toBe(1);
    retry.release();
    await expect(card.getByText(/It was cancelled/)).toBeVisible();
    await expect(card.getByRole("status", { name: "Investigation status" })).toBeFocused();
    await card.getByRole("button", { name: "Try again (2 of 3 used)" }).focus();
    await page.keyboard.press("Space");
    await expect(card.getByText(/service or records were unavailable/)).toBeVisible();
    await expect(card.getByRole("status", { name: "Investigation status" })).toBeFocused();
    await expect(card.getByText(/All 3 attempts are used/)).toBeVisible();
    await expect(card.getByRole("button", { name: /Try again/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);
    expect(retries).toBe(2);
    await page.reload();
    await card.getByText("Details", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(card.getByText(/Earlier attempts: #1 incomplete \(tool limit\), #2 cancelled/)).toBeVisible();
    await page.screenshot({ path: "test-results/ui05-recovery.png", fullPage: true });
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
    await page.getByRole("button", { name: "Load October payments" }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    holdRead = true;
    await expect.poll(() => held).toBe(true);
    await page.getByRole("button", { name: "Reset demo" }).focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Confirm reset" }).click();
    await expect(page.getByText("No flags yet")).toBeVisible();
    staleRead.release();
    injection.release();
    await Promise.all([readDelivered.promise, mutationDelivered.promise]);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(/✓ Reviewed/)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("No flags yet")).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(/✓ Reviewed/)).toHaveCount(0);
  } finally { injection.release(); staleRead.release(); }
});

test("read denial and mutation 401 hide records; scoped mutation 403 preserves readable records", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let status = 401;
  let mutationStatus = 403;
  let posts = 0;
  await page.route("**/api/demo", async route => {
    if (route.request().method() === "POST") { posts++; return route.fulfill({ status: mutationStatus, json: { error: "unauthorized" } }); }
    return route.fulfill(status === 200 ? { json: injected } : { status, json: { error: "unauthorized" } });
  });
  await page.goto("/");
  await expect(page.locator("main").getByRole("alert")).toContainText("Sign in again");
  await expect(page.getByRole("button", { name: "Load October payments" })).toBeDisabled();
  status = 403;
  await page.getByRole("button", { name: "Reload", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main").getByRole("alert")).toContainText("Access denied");
  status = 200;
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Access denied");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText(/✓ Reviewed/)).toHaveCount(0);
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Access denied");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  mutationStatus = 401;
  await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Sign in again");
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(posts).toBe(3);
});

test("stub, incomplete, invalid-reference and unresolved findings never show as checked", async ({ page }) => {
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
    Object.assign(run, { mode: variant.mode, state: variant.state, error: variant.state === "incomplete" ? "tool_limit" : null });
    Object.assign(finding, { referenceStatus: variant.referenceStatus, label: variant.label });
    await opened(page);
    const card = page.getByRole("article");
    await expect(card.getByText(/^Not verified:/)).toBeVisible();
    await expect(card.getByText("Checked against the records", { exact: true })).toHaveCount(0);
    await expect(card.locator(".flag-top .badge")).not.toHaveText("Explained");
    await expect(page.locator(".badge").filter({ hasText: /^Explained$/ })).toHaveCount(0);
  }
});

test("review counts include only completed latest runs; unfinished runs cannot be reviewed", async ({ page }) => {
  const state = copy(injected);
  const exception = state.exceptions[0];
  const run = state.runs[0];
  const states = ["completed", "pending", "running", "incomplete", "failed", "cancelled"] as const;
  state.exceptions = states.map(status => ({ ...copy(exception), id: `${exception.id}:${status}` }));
  state.runs = states.map((status, index) => ({ ...copy(run), id: `${run.id}:${status}`, exceptionId: state.exceptions[index].id, state: status, findings: [], error: ["incomplete", "failed"].includes(status) ? "unavailable" : null, reviewedAt: status === "completed" ? "2026-11-09T18:00:00.000Z" : null }));
  await page.route("**/api/demo", route => route.fulfill({ json: state }));
  await opened(page);
  await expect(page.getByText("1 of 6 flags reviewed")).toBeVisible();
  await expect(page.getByText(/✓ Reviewed/)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Mark reviewed", exact: true })).toHaveCount(0);
  await expect(page.getByText(/didn't finish/)).toHaveCount(3);
  await expect(page.getByText(/Preparing a placeholder \(no AI call in this mode\)/)).toHaveCount(2);
});

test("a stalled progress read times out without cancelling execution and can be reloaded", async ({ page }) => {
  let state = copy(baseline);
  const injection = gate();
  const stalledRead = gate();
  let holdRead = false;
  let stalled = false;
  let posts = 0;
  let cancelledPosts = 0;
  page.on("requestfailed", request => { if (request.method() === "POST") cancelledPosts++; });
  await page.route("**/api/demo", async route => {
    if (route.request().method() === "GET") {
      if (holdRead) { stalled = true; await stalledRead.promise; }
      return route.fulfill({ json: state });
    }
    posts++;
    state = copy(injected);
    state.runs[0].state = "running";
    holdRead = true;
    await injection.promise;
    return route.fulfill({ json: { ok: true, generation: state.generation, changed: true } });
  });
  try {
    await opened(page);
    await page.getByRole("button", { name: "Load October payments" }).click();
    await expect.poll(() => stalled).toBe(true);
    await expect(page.locator("main").getByRole("alert")).toContainText("Progress request timed out", { timeout: 8000 });
    expect(cancelledPosts).toBe(0);
    holdRead = false;
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Investigation progress" })).toBeVisible();
    state.runs[0].state = "completed";
    injection.release();
    stalledRead.release();
    await expect(page.getByRole("button", { name: "Mark reviewed", exact: true })).toBeEnabled();
    expect(posts).toBe(1);
    expect(cancelledPosts).toBe(0);
  } finally { injection.release(); stalledRead.release(); }
});
