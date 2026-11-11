import { test, expect } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:3100", "X-Spendwise-Demo": "1" };
test.beforeAll(async ({ request }) => {
  expect((await request.post("/api/demo", { headers, data: { action: "reset" } })).status()).toBe(200);
  expect((await request.post("/api/demo", { headers, data: { action: "inject", scenarioId: "demo-v1" } })).status()).toBe(200);
});
test.afterAll(async ({ request }) => {
  expect((await request.post("/api/demo", { headers, data: { action: "reset" } })).status()).toBe(200);
});

test("one vendor list: flagged first, tabs filter without mutation, detail shows every flag", async ({ page }) => {
  let posts = 0;
  page.on("request", request => { if (request.method() === "POST") posts++; });
  await page.goto("/");
  const list = page.getByRole("region", { name: "Vendors" });
  await expect(list.locator(".vendor-row")).toHaveCount(5);
  await expect(list.locator(".vendor-row").first()).toContainText("Northstar POS Cloud");
  const harbor = list.locator(".vendor-row").filter({ hasText: "Harbor Tax & Advisory" });
  await harbor.focus();
  await page.keyboard.press("Enter");
  await expect(harbor).toHaveAttribute("aria-current", "true");
  const detail = page.locator("#vendor-detail");
  await expect(detail.getByRole("heading", { name: "Harbor Tax & Advisory" })).toBeVisible();
  await expect(detail).toContainText("Change +$6,000 (new this month)");
  await expect(detail.getByRole("article")).toHaveCount(2);
  await expect(detail.getByRole("article").nth(1)).toContainText("Two payments of $3,000, 2 days apart.");
  await expect(detail.getByRole("article").nth(1)).toContainText("Both payments point to the same invoice, HA-101.");
  // Repeated identical payments collapse into one line that says how many.
  await expect(detail.getByRole("article").first().getByLabel("From the records")).toContainText("New in October: 2 payments of $3,000");
  await expect(detail.getByRole("article").first().getByLabel("From the records")).toContainText("same invoice each time");
  await list.getByRole("tab", { name: /All vendors 12/ }).click();
  await expect(list.locator(".vendor-row")).toHaveCount(12);
  const rent = list.locator(".vendor-row").filter({ hasText: "Main Street Properties" });
  await rent.click();
  await expect(detail).toContainText("No flags. October looks normal for this vendor.");
  await expect(detail.getByRole("article")).toHaveCount(0);
  expect(posts).toBe(0);
});

test("Help, tour, About and the how-to popover are short, keyboard friendly and never mutate", async ({ page }) => {
  let posts = 0;
  page.on("request", request => { if (request.method() === "POST") posts++; });
  await page.goto("/");
  const helpButton = page.getByRole("button", { name: "Help", exact: true });
  await helpButton.click();
  const help = page.getByRole("dialog", { name: "Help" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("button", { name: "Close" })).toBeFocused();
  await help.getByText("Why can't I click some buttons?", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(help.getByText(/need an authorized sign-in/)).toBeVisible();
  await help.getByRole("button", { name: "Take the 3-step tour" }).click();
  for (const heading of ["Read why and the answer", "Decide and mark reviewed"]) {
    await help.getByRole("button", { name: "Next", exact: true }).click();
    await expect(help.getByRole("heading", { name: heading, exact: true })).toBeFocused();
  }
  await help.getByRole("button", { name: "Done" }).click();
  await expect(help).toBeHidden();
  await expect(helpButton).toBeFocused();
  await helpButton.click();
  await help.getByRole("button", { name: "Take the 3-step tour" }).click();
  await help.getByRole("button", { name: "Show me" }).click();
  await expect(page.getByRole("region", { name: "Vendors" })).toBeFocused();
  await page.getByRole("button", { name: "About", exact: true }).click();
  const about = page.getByRole("dialog", { name: "About SpendWise" });
  await expect(about.getByRole("link", { name: "README" })).toHaveAttribute("href", /blob\/main\/README\.md/);
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
  await expect(page.getByRole("button", { name: "About", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "How to read this", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How to read this" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "How to read this" })).toBeHidden();
  // The synthetic-data notice appears once.
  await expect(page.getByText("Synthetic demo data", { exact: true })).toHaveCount(1);
  expect(posts).toBe(0);
});

test("responsive layout, dialogs and reduced motion remain usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".vendor-row").first()).toBeVisible();
  for (const width of [375, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(Number.parseFloat(await page.locator(".fill").first().evaluate(el => getComputedStyle(el).transitionDuration))).toBeLessThan(0.01);
    await page.getByRole("button", { name: "Help", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Help" });
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `test-results/ui05-${width}.png`, fullPage: true });
  }
});
