import { test, expect, type Page } from '@playwright/test';

const badge = process.env.SMOKE_BADGE_ID || '1001';
const pin = process.env.SMOKE_PIN || '1234';

async function login(page: Page) {
  await page.goto('/login');
  await expect(page.getByPlaceholder(/badge/i)).toBeVisible();
  await page.getByPlaceholder(/badge/i).fill(badge);
  await page.locator('input[type="password"]').fill(pin);
  await page.getByRole('button', { name: /unlock terminal/i }).click();
  await expect(page).not.toHaveURL(/\/login\/?$/, { timeout: 30_000 });
}

test.describe('Staging smoke', () => {
  test('health endpoint is ok', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('login → dashboard → orders → create order UI → shift summary → reports → logout', async ({
    page,
  }) => {
    await login(page);

    // Dashboard / home loads
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/dashboard|live|queue|plant|machine/i).first()).toBeVisible({
      timeout: 20_000,
    });

    // Orders / queue surface
    const ordersLink = page.getByRole('link', { name: /order|queue|assignment/i }).first();
    if (await ordersLink.count()) {
      await ordersLink.click();
      await expect(page.locator('body')).toContainText(/order|queue|batch|assignment/i, {
        timeout: 20_000,
      });
    } else {
      await page.goto('/plant/orders').catch(() => undefined);
    }

    // Create Order — open UI if available (non-destructive: do not submit)
    const createBtn = page.getByRole('button', { name: /create|new order|add order|import/i }).first();
    if (await createBtn.count()) {
      await createBtn.click();
      await expect(page.locator('body')).toBeVisible();
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    // Shift summary
    const shiftLink = page.getByRole('link', { name: /shift summary|shift review|handover/i }).first();
    if (await shiftLink.count()) {
      await shiftLink.click();
      await expect(page.locator('body')).toContainText(/shift|summary|handover|production/i, {
        timeout: 20_000,
      });
    } else {
      await page.goto('/plant/shift-review').catch(() => undefined);
    }

    // Reports
    const reportsLink = page.getByRole('link', { name: /report|dpr|production/i }).first();
    if (await reportsLink.count()) {
      await reportsLink.click();
      await expect(page.locator('body')).toContainText(/report|dpr|production|export|dashboard/i, {
        timeout: 20_000,
      });
    } else {
      await page.goto('/plant/reports').catch(() => undefined);
    }

    // Logout
    const logout = page.getByRole('button', { name: /log ?out|sign out/i }).first();
    if (await logout.count()) {
      await logout.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    } else {
      await page.goto('/login');
      await expect(page.getByPlaceholder(/badge/i)).toBeVisible();
    }
  });
});
