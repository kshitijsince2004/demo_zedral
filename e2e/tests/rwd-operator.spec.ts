import { test, expect } from "@playwright/test";

/**
 * RWD operator flow (plan section 8). Full plant seed required - skips unless RWD_E2E=1.
 */
test.describe("RWD operator", () => {
  test.skip(!process.env.RWD_E2E, "Set RWD_E2E=1 with seeded plan row to run");

  test("queue shows plan prefill and submit advances to annealing", async ({ page }) => {
    await page.goto("/u/demo/process/rwd");
    await expect(page.getByText(/Rewinding/i)).toBeVisible({ timeout: 30_000 });

    const card = page.getByRole("button").filter({ hasText: /1100038398/ }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/VICTURA|AXIS/i);
    await expect(card).toContainText("705");
    await expect(card).toContainText("1.55");

    await card.click();
    await expect(page.getByText(/Pre-Stage Thickness/i)).toBeVisible();

    await page.getByLabel(/RW Tension 1/i).fill("800");
    await page.getByLabel(/RW Tension 2/i).fill("810");
    await page.getByLabel(/RW Tension 3/i).fill("820");
    await page.getByLabel(/Observed Thickness/i).fill("1.54");
    await page.getByRole("button", { name: /Submit RWD/i }).click();

    await page.goto("/u/demo/process/ann");
    await expect(page.getByText(/1100038398/)).toBeVisible({ timeout: 30_000 });
  });
});