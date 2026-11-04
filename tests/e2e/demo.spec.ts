import { test, expect } from "@playwright/test";
test("INV-09/10: inject, inspect, review, persist and reset", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Reset demo" })).toBeEnabled();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText("Baseline ready")).toBeVisible();
  await page.getByRole("button", { name: "Simulate new payments" }).click();
  await expect(page.getByText("Stub · no AI call")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Scenario injected" }),
  ).toBeDisabled();
  await page.getByText("Inspect source records").first().click();
  await expect(page.locator("details[open] .record").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true }),
  ).toHaveCount(1);
  const denied = await request.post("/api/demo", { data: { action: "reset" } });
  expect(denied.status()).toBe(403);
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText("Baseline ready")).toBeVisible();
  await expect(page.getByText("Stub · no AI call")).toHaveCount(0);
});
