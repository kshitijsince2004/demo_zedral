import { test, expect } from "@playwright/test";

/**
 * RWD operator flow. Full plant seed required - skips unless RWD_E2E=1.
 * Routes: user-scope ProcessHub → /rewinding/:coilNo capture.
 */
test.describe("RWD operator", () => {
  test.skip(!process.env.RWD_E2E, "Set RWD_E2E=1 with seeded plan row to run");

  test("queue shows plan prefill and save completes order", async ({ page }) => {
    // Operator user-scope root when activeMachine=RWD (not legacy /process/rwd).
    await page.goto("/u/demo/operator");
    await expect(page.getByText(/Rewinding|Orders/i)).toBeVisible({ timeout: 30_000 });

    const card = page.getByRole("button").filter({ hasText: /1100038398/ }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/VICTURA|AXIS/i);

    await card.click();
    // MTP may open allocate modal — confirm RWD if shown.
    const assign = page.getByRole("button", { name: /^RWD$/i });
    if (await assign.isVisible().catch(() => false)) {
      await assign.click();
      await page.getByRole("button", { name: /Confirm|Assign/i }).click();
    }

    await expect(page.getByText(/RW Tension/i)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /^Start$/i }).click();
    await page.getByLabel(/RW Tension 1/i).fill("800");
    await page.getByLabel(/RW Tension 2/i).fill("810");
    await page.getByLabel(/RW Tension 3/i).fill("820");
    await page.getByLabel(/Observed Thickness/i).fill("1.54");
    await page.getByRole("button", { name: /Save Production Data/i }).click();

    await expect(page.getByText(/Rewinding|Orders|Completed/i)).toBeVisible({ timeout: 30_000 });
  });
});
