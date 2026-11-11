import { test, expect } from "@playwright/test";
test("INV-09/10: load, inspect, review, persist and reset", async ({
  page,
  request,
}) => {
  // Cold dev-route compilation and PGlite startup precede any investigation.
  // Assert the actual initial response rather than racing the 5s UI default.
  const initialState = page.waitForResponse(
    response => new URL(response.url()).pathname === "/api/demo" && response.request().method() === "GET",
    { timeout: 20_000 },
  );
  await page.goto("/");
  const initialResponse = await initialState;
  expect(initialResponse.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Reset demo" })).toBeEnabled();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("button", { name: "Confirm reset" })).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Reset demo" })).toBeFocused();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByText("No flags yet")).toBeVisible();
  // Everyday vendors are listed before any flag exists.
  await expect(page.getByRole("tab", { name: /All vendors 12/ })).toBeVisible();
  await page.getByRole("button", { name: "Load October payments" }).click();
  await expect(page.getByText("0 of 6 flags reviewed")).toBeVisible();
  await expect(page.getByRole("button", { name: "October payments loaded" })).toBeDisabled();
  // The largest flagged change is selected first; its card shows why and a placeholder answer.
  const card = page.getByRole("article").first();
  await expect(card).toContainText("Why flagged: Paid $12,000 more than in September");
  await expect(card.locator(".badge")).toHaveText("Placeholder");
  await expect(card).toContainText("Not verified: Placeholder only: no AI investigation ran.");
  await card.locator(".chip").first().click();
  await expect(card.locator(".record")).toBeVisible();
  await card.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(card.getByText(/✓ Reviewed/)).toBeVisible();
  await expect(page.getByText("1 of 6 flags reviewed")).toBeVisible();
  // Fully reviewed vendors move to Checked; the selection stays put (no jump).
  await expect(page.getByRole("tab", { name: /Checked 1/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Northstar POS Cloud", level: 2 })).toBeVisible();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByText("1 of 6 flags reviewed")).toBeVisible();
  const denied = await request.post("/api/demo", { data: { action: "reset" } });
  expect(denied.status()).toBe(403);
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText("Clear 6 findings and 1 review?")).toBeVisible();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByText("No flags yet")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});
