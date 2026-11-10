/** After build: isolated production browser/auth QA. Synthetic data; no OAuth or model calls. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { encode } from "next-auth/jwt";

const output = resolve(process.env.UI03_OUTPUT_DIR ?? "test-results/ui03-hosted");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "spendwise-ui03-"));
const canonical = "https://spendwise-ui03.invalid";
const local = "http://127.0.0.1:3198";
const secret = "offline-ui03-test-secret-not-for-hosting-123456789";
const salt = "__Secure-authjs.session-token";
let browser;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3198"], {
  env: { ...process.env, VERCEL: "", DATABASE_MODE: "local", PGLITE_DATA_DIR: directory, INVESTIGATOR_MODE: "stub", ANTHROPIC_API_KEY: "",
    AUTH_URL: canonical, AUTH_SECRET: secret, AUTH_GITHUB_ID: "offline-id", AUTH_GITHUB_SECRET: "offline-secret", SPENDWISE_PUBLIC_READ: "1",
    SPENDWISE_ACCESS_GRANTS: JSON.stringify({ "github:123": { permissions: ["read", "inject", "reset", "review", "retry"] }, "github:456": { permissions: ["read"] } }) },
  stdio: ["ignore", "pipe", "pipe"],
});
async function cookie(sub, age = 0) {
  return `${salt}=${await encode({ token: { sub, signedInAt: Math.floor(Date.now() / 1000) - age }, salt, secret, maxAge: 3600 })}`;
}
async function api(path = "/api/demo", body, identity = "", origin = canonical) {
  return fetch(local + path, { method: body ? "POST" : "GET", headers: { cookie: identity, origin, "content-type": "application/json", "x-spendwise-demo": "1" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function contextFor(identity = "") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (identity) await context.addCookies([{ name: salt, value: identity.slice(salt.length + 1), domain: "spendwise-ui03.invalid", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  // Test transport only: browser sees the canonical HTTPS origin while requests
  // reach the isolated local production process. No application bypass/patch.
  await context.route(`${canonical}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const response = await context.request.fetch(local + url.pathname + url.search, {
      method: request.method(), headers: { ...await request.allHeaders(), host: "spendwise-ui03.invalid" },
      ...(request.postDataBuffer() ? { data: request.postDataBuffer() } : {}), maxRedirects: 0,
    });
    await route.fulfill({ response });
  });
  return context;
}
async function audit(page, label) {
  if (!process.env.UI03_AXE_SOURCE) return;
  // Inspect the settled render, after finite entrance/focus transitions finish.
  await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  await page.addScriptTag({ path: process.env.UI03_AXE_SOURCE });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })));
  assert.deepEqual(violations, [], `${label}: accessibility violations ${JSON.stringify(violations)}`);
  console.log(`Accessibility: ${label} passed WCAG 2.0/2.1 A/AA automated scan`);
}
try {
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("Production startup timeout")), 30000);
    server.stdout.on("data", chunk => { if (String(chunk).includes("Ready")) { clearTimeout(timer); resolveReady(); } });
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Production server stopped")); });
    server.once("error", reject);
  });
  const admin = await cookie("github:123");
  assert.equal((await api("/api/demo", { action: "inject", scenarioId: "demo-v1" }, admin)).status, 200);
  const data = await (await api()).json();
  assert.equal(data.exceptions.length, 4);
  assert(data.runs.every(run => run.mode === "stub" && run.modelRequests === 0));
  const mutations = [["/api/demo", { action: "inject", scenarioId: "demo-v1" }], ["/api/demo", { action: "reset" }], ["/api/demo", { action: "review", runId: data.runs[0].id }], ["/api/demo/retry", { predecessorId: data.runs[0].id }]];
  for (const [path, body] of mutations) {
    assert.equal((await api(path, body)).status, 401);
    assert.equal((await api(path, body, await cookie("github:456"))).status, 403);
    assert.equal((await api(path, body, await cookie("github:789"))).status, 403);
  }
  assert.equal((await api("/api/demo", { action: "reset" }, await cookie("github:123", 3601))).status, 401);
  assert.equal((await api("/api/demo", { action: "reset" }, admin, "https://foreign.invalid")).status, 403);
  console.log("Hosted HTTP: public read 200; all public mutations 401; read-only/ungranted mutations 403; expired session 401; cross-origin mutation 403; model requests 0");

  browser = await chromium.launch();
  for (const [label, identity] of [["public", ""], ["read-only", await cookie("github:456")], ["ungranted", await cookie("github:789")]]) {
    const context = await contextFor(identity);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(canonical);
    await page.getByRole("button", { name: /Harbor Tax & Advisory/ }).waitFor();
    assert(await page.getByRole("button", { name: "Payments added", exact: true }).isDisabled());
    assert(await page.getByRole("button", { name: "Reset demo", exact: true }).isDisabled());
    for (const button of await page.getByRole("button", { name: "Mark reviewed", exact: true }).all()) assert(await button.isDisabled());
    if (label === "public") {
      assert(await page.getByRole("button", { name: "Sign in with GitHub", exact: true }).isVisible());
      await audit(page, "public desktop dashboard");
      await page.screenshot({ path: join(output, "desktop.png"), fullPage: true });
      await page.screenshot({ path: join(output, "desktop-overview.png") });
      await page.getByRole("button", { name: "How to read this", exact: true }).click();
      await audit(page, "chart explanation popover");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Help & tour", exact: true }).click();
      await page.getByRole("button", { name: "Start guided tour", exact: true }).click();
      await audit(page, "Help and tour dialog");
      await page.screenshot({ path: join(output, "help-tour.png") });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "About", exact: true }).click();
      await audit(page, "About dialog");
      await page.screenshot({ path: join(output, "about.png") });
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 375, height: 1000 });
      await audit(page, "public mobile dashboard");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, "mobile.png"), fullPage: true });
      await page.screenshot({ path: join(output, "mobile-overview.png") });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole("button", { name: /Harbor Tax & Advisory/ }).click();
    await page.getByRole("button", { name: "Review 2 exceptions", exact: true }).click();
    assert.equal(await page.getByRole("article").count(), 2);
    const card = page.getByRole("article").first();
    await card.getByText("Run details", { exact: true }).click();
    await card.getByText(/Inspect source records/).click();
    assert(await card.getByText(/Provenance: current synthetic demo dataset/).isVisible());
    if (label === "public") {
      await audit(page, "expanded run and source records");
      await page.screenshot({ path: join(output, "records.png"), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(`Browser: ${label} dashboard, disabled mutations, vendor filtering, run/source inspection; no page errors`);
    await context.close();
  }
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
  await rm(directory, { recursive: true, force: true });
}
