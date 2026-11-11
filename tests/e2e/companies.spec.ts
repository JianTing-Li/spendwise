import { test, expect, type Page } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:3100", "X-Spendwise-Demo": "1" };
test.beforeEach(async ({ request }) => {
  for (const company of ["roast", "hubspot", "gxo"]) expect((await request.post(`/api/demo?company=${company}`, { headers, data: { action: "reset" } })).status()).toBe(200);
});
const vendor = (page: Page, name: RegExp) => page.locator(".vendor-row").filter({ hasText: name });

test("company selection preserves separate payments, reviews, reset state and reload identity", async ({ page }) => {
  await page.goto("/");
  const selector = page.getByLabel("Company", { exact: true });
  await expect(selector).toBeEnabled();
  await selector.selectOption("hubspot");
  await expect(page).toHaveURL(/company=larkspur/);
  await expect(selector.locator("option:checked")).toHaveText("Larkspur Software");
  await expect(page.locator("body")).not.toContainText(/HubSpot|GXO/);
  await expect(vendor(page, /Summit Cloud Security/)).toContainText("$2,000");
  await page.getByRole("button", { name: "Load October payments" }).click();
  await expect(page.getByText("0 of 6 flags reviewed")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Summit Cloud Security", level: 2 })).toBeVisible();
  await expect(vendor(page, /Summit Cloud Security/)).toContainText("$26,000");
  await page.getByRole("article").first().getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(page.getByText("1 of 6 flags reviewed")).toBeVisible();
  await expect(selector).toBeEnabled();
  await selector.selectOption("gxo");
  await expect(page.getByText("No flags yet")).toBeVisible();
  await expect(vendor(page, /Atlas Automation Services/)).toContainText("$4,000");
  await page.getByRole("button", { name: "Load October payments" }).click();
  await expect(page.getByText("0 of 6 flags reviewed")).toBeVisible();
  const detail = page.locator("#vendor-detail");
  await detail.getByText(/All records for this vendor/).click();
  await expect(detail).toContainText("Annual warehouse robotics service coverage");
  await expect(detail).not.toContainText("endpoint security");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByText("No flags yet")).toBeVisible();
  await expect(selector).toBeEnabled();
  await selector.selectOption("hubspot");
  await expect(page.getByText("1 of 6 flags reviewed")).toBeVisible();
  await page.reload();
  await expect(selector).toHaveValue("hubspot");
  await expect(page.getByText("1 of 6 flags reviewed")).toBeVisible();
  await expect(selector).toBeEnabled();
  await selector.selectOption("roast");
  await expect(page.getByText("No flags yet")).toBeVisible();
  await expect(vendor(page, /Northstar POS Cloud/)).toBeVisible();
});

test("deep-linked companies keep a short description, keyboard focus and no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.goto("/?company=ironbridge");
  const selector = page.getByLabel("Company", { exact: true });
  await expect(selector).toHaveValue("gxo");
  await expect(selector).toBeEnabled();
  await selector.focus();
  await expect(selector).toBeFocused();
  await expect(page.locator(".company")).toContainText("A warehouse operator");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selector.selectOption("hubspot");
  await expect(page.locator(".company")).toContainText("A software company");
  await expect(page.getByRole("button", { name: "Load October payments" })).toBeEnabled();
  await expect(selector).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Old internal IDs in links still work.
  await page.goto("/?company=gxo");
  await expect(selector).toHaveValue("gxo");
});
