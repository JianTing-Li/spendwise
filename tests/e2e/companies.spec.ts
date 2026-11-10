import { test, expect } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:3100", "X-Spendwise-Demo": "1" };
test.beforeEach(async ({ request }) => {
  for (const company of ["roast", "hubspot", "gxo"]) expect((await request.post(`/api/demo?company=${company}`, { headers, data: { action: "reset" } })).status()).toBe(200);
});

test("company selection preserves separate payments, acknowledgments, reset state and reload identity", async ({ page }) => {
  await page.goto("/");
  const selector = page.getByLabel("Explore a company demo", { exact: true });
  await expect(selector).toBeEnabled();
  await selector.selectOption("hubspot");
  await expect(page.locator(".eyebrow").filter({ hasText: /^HubSpot$/ })).toBeVisible();
  await expect(page.getByText(/Unaffiliated hypothetical scenario/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Summit Cloud Security/ })).toContainText("$2,000.00");
  await page.getByRole("button", { name: "Simulate new payments" }).click();
  await expect(page.getByRole("article")).toHaveCount(4);
  await expect(page.getByRole("article").first()).toContainText("Summit Cloud Security");
  await expect(page.getByRole("article").first()).toContainText("$26,000.00");
  await page.getByRole("button", { name: "Mark reviewed", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Reviewed", exact: true })).toHaveCount(1);
  await expect(selector).toBeEnabled();
  await selector.selectOption("gxo");
  await expect(page.getByText("Baseline ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Atlas Automation Services/ })).toContainText("$4,000.00");
  await page.getByRole("button", { name: "Simulate new payments" }).click();
  await expect(page.getByRole("article")).toHaveCount(4);
  const card = page.getByRole("article").first();
  await card.getByText(/Inspect source records/).click();
  await expect(card).toContainText("Annual warehouse robotics service coverage");
  await expect(card).not.toContainText("endpoint security");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByText("Baseline ready", { exact: true })).toBeVisible();
  await expect(selector).toBeEnabled();
  await selector.selectOption("hubspot");
  await expect(page.getByRole("button", { name: "Reviewed", exact: true })).toHaveCount(1);
  await page.reload();
  await expect(selector).toHaveValue("hubspot");
  await expect(page.getByRole("button", { name: "Reviewed", exact: true })).toHaveCount(1);
  await expect(selector).toBeEnabled();
  await selector.selectOption("roast");
  await expect(page.getByText("Baseline ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Northstar POS Cloud/ })).toBeVisible();
});

test("deep-linked companies have responsive, keyboard-accessible synthetic context", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.goto("/?company=gxo");
  const selector = page.getByLabel("Explore a company demo", { exact: true });
  await expect(selector).toHaveValue("gxo");
  await expect(selector).toBeEnabled();
  await selector.focus();
  await expect(selector).toBeFocused();
  await expect(page.locator(".company-selector")).toContainText("Warehousing & distribution");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selector.selectOption("hubspot");
  await expect(page.locator(".company-selector")).toContainText("Software & digital services");
  await expect(page.getByRole("button", { name: "Simulate new payments" })).toBeEnabled();
  await expect(selector).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
