import { test, expect } from "@playwright/test";
import type { DemoState } from "../../src/contracts";

const headers = { Origin: "http://127.0.0.1:3100", "X-Spendwise-Demo": "1" };
let state: DemoState;
test.beforeAll(async ({ request }) => {
  expect((await request.post("/api/demo", { headers, data: { action: "reset" } })).status()).toBe(200);
  expect((await request.post("/api/demo", { headers, data: { action: "inject", scenarioId: "demo-v1" } })).status()).toBe(200);
  state = await (await request.get("/api/demo")).json();
});
test.afterAll(async ({ request }) => {
  expect((await request.post("/api/demo", { headers, data: { action: "reset" } })).status()).toBe(200);
});

test("vendor comparison precedes queue, shows exact values and filters without mutation", async ({ page }) => {
  let posts = 0;
  page.on("request", request => { if (request.method() === "POST") posts++; });
  await page.goto("/");
  const insights = page.getByRole("region", { name: "Vendor payment insights" });
  await expect(insights).toBeVisible();
  const queue = page.getByRole("region", { name: "Investigation queue" });
  expect((await insights.boundingBox())!.y).toBeLessThan((await queue.boundingBox())!.y);
  const harbor = insights.getByRole("button", { name: /Harbor Tax & Advisory/ });
  await harbor.focus();
  await page.keyboard.press("Enter");
  await expect(harbor).toHaveAttribute("aria-pressed", "true");
  const spotlight = insights.locator(".vendor-spotlight");
  await expect(spotlight).toContainText("$6,000.00");
  await expect(spotlight).toContainText("n/a (prior is $0.00)");
  await insights.getByRole("button", { name: "Review 2 exceptions" }).click();
  await expect(queue).toBeFocused();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").first()).toContainText("Harbor Tax & Advisory");
  await page.getByRole("button", { name: "Show all exceptions" }).click();
  await expect(page.getByRole("article")).toHaveCount(4);
  await insights.getByText("All vendor values", { exact: true }).click();
  await expect(insights.getByRole("table")).toBeVisible();
  expect(posts).toBe(0);
});

test("long draft stays bounded, full qualifications and source provenance remain available", async ({ page }) => {
  const mock = structuredClone(state);
  const run = mock.runs.find(r => r.exceptionId.includes("vendor-renewal"))!;
  const ending = "These records do not establish payment approval or accounting treatment.";
  run.findings[0].explanation = "The annual subscription invoice is linked to the completed payment. " + "Review the cited records and compare their descriptions. ".repeat(30) + ending;
  run.findings[0].nextStep = "Ask the analyst to compare payment status and invoice references. ".repeat(10);
  run.findings[0].evidence = [{ type: "payment", id: "pay-renewal-annual" }];
  await page.route("**/api/demo", route => route.fulfill({ json: mock }));
  await page.goto("/");
  const card = page.getByRole("article", { name: "Northstar POS Cloud payment increase" });
  await expect(card.locator(".brief-note")).toBeVisible();
  expect((await card.locator(".brief-note").innerText()).split(/\s+/).length).toBeLessThanOrEqual(75);
  await expect(card.getByText(/full wording may contain qualifications/)).toBeVisible();
  await expect(card.locator(".full-note p").first()).toBeHidden();
  await card.getByText("Read full note and next step", { exact: true }).click();
  await expect(card.locator(".full-note")).toContainText(ending);
  await card.getByText("Run details", { exact: true }).click();
  await expect(card.getByText(/No AI investigation ran and no explanation was verified/)).toBeVisible();
  await expect(card.getByText(/Generation identifies the demo reset cycle/)).toBeVisible();
  await card.getByRole("link", { name: "payment: pay-renewal-annual", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("group", { name: "Payment pay-renewal-annual", exact: true })).toBeFocused();
  await expect(card.getByRole("group", { name: "Payment pay-renewal-annual", exact: true })).toContainText("Cited in latest attempt");
  await expect(card.getByRole("group", { name: "Invoice inv-renewal", exact: true })).toContainText("Vendor context · not cited in latest attempt");
  await expect(card.getByText(/not a complete retrieval audit/)).toBeVisible();
});

test("Help FAQ, tour, About and popover support keyboard, focus return and zero mutations", async ({ page }) => {
  let posts = 0;
  page.on("request", request => { if (request.method() === "POST") posts++; });
  await page.goto("/");
  const helpButton = page.getByRole("button", { name: "Help & tour", exact: true });
  await helpButton.click();
  const help = page.getByRole("dialog", { name: "Help & app tour" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("button", { name: "Close help" })).toBeFocused();
  await help.getByText("Why are some controls disabled?", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(help.getByText(/Signing in alone does not grant permissions/)).toBeVisible();
  await help.getByRole("button", { name: "Start guided tour" }).click();
  for (const heading of ["Understand the flag", "Read the finding and run", "Check sources, then acknowledge"]) {
    await help.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(help.getByRole("heading", { name: heading, exact: true })).toBeFocused();
  }
  await help.getByRole("button", { name: "Finish tour" }).click();
  await expect(help).toBeHidden();
  await expect(helpButton).toBeFocused();
  await helpButton.click();
  await help.getByRole("button", { name: "Start guided tour" }).click();
  await help.getByRole("button", { name: "Show this area" }).click();
  await expect(page.getByRole("region", { name: "Vendor payment insights" })).toBeFocused();
  await page.getByRole("button", { name: "About", exact: true }).click();
  const about = page.getByRole("dialog", { name: "About SpendWise" });
  await expect(about.getByRole("link", { name: "Read the source README" })).toHaveAttribute("href", /180871a.*README.md/);
  await expect(about).toContainText("remain unmeasured");
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
  await expect(page.getByRole("button", { name: "About", exact: true })).toBeFocused();
  const trigger = page.getByRole("button", { name: "How to read this", exact: true });
  await trigger.click();
  await expect(page.getByRole("heading", { name: "Compare cash, then inspect evidence" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Compare cash, then inspect evidence" })).toBeHidden();
  expect(posts).toBe(0);
});

test("responsive chart, dialog and reduced motion remain usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".vendor-bar")).toHaveCount(3);
  for (const width of [375, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".bar-fill").first().evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
    await page.getByRole("button", { name: "Help & tour", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Help & app tour" });
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `test-results/ui03-${width}.png`, fullPage: true });
  }
});
