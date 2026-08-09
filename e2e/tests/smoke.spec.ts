import { test, expect, type Page } from '@playwright/test';

// Seeded pilot operator is emp_code 3000 / PIN 1234 (seed-pilot-users.mjs).
// CI must set SMOKE_BADGE_ID + SMOKE_PIN explicitly (workflow fail-fast); no bogus 1001.
// Trim — GitHub secrets often include a trailing newline that breaks /^\d{4}$/ PIN checks.
const isCi = Boolean(process.env.CI);
const badge = (process.env.SMOKE_BADGE_ID || (isCi ? '' : '3000')).trim();
const pin = (process.env.SMOKE_PIN || (isCi ? '' : '1234')).trim();

if (!badge || !pin) {
  throw new Error(
    'SMOKE_BADGE_ID and SMOKE_PIN are required (seeded badge e.g. 3000 / PIN 1234). ' +
      'Empty secrets used to fall back to 1001 which is not a seeded user.',
  );
}
if (!/^\d{4}$/.test(pin)) {
  throw new Error(
    `SMOKE_PIN must be exactly 4 digits after trim (got length=${pin.length}). ` +
      'Remove quotes/newlines from the staging secret.',
  );
}

function cdnHint(status: number): string {
  if (status >= 521 && status <= 524) {
    return (
      ` Cloudflare ${status}: CDN cannot reach origin. ` +
      `Local deploy /health may still be OK — check AWS SG (80/443), DNS A→EIP, Cloudflare SSL. ` +
      `Do not treat this as a bad image.`
    );
  }
  return '';
}

async function login(page: Page) {
  const res = await page.goto('/login');
  if (res && !res.ok()) {
    throw new Error(
      `Failed to load /login. Status: ${res.status()} ${res.statusText()}.${cdnHint(res.status())}`,
    );
  }
  await expect(page.getByPlaceholder(/badge/i)).toBeVisible();
  await page.getByPlaceholder(/badge/i).fill(badge);
  await page.locator('input[type="password"]').fill(pin);
  await page.getByRole('button', { name: /unlock terminal/i }).click();
  try {
    await expect(page).not.toHaveURL(/\/login\/?$/, { timeout: 30_000 });
  } catch {
    const uiError = await page
      .locator('.text-destructive, [role="alert"]')
      .first()
      .textContent()
      .catch(() => null);
    const snippet = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 280);
    throw new Error(
      `Login stayed on /login after Unlock (badge=${badge}).` +
        (uiError?.trim() ? ` UI error: ${uiError.trim()}.` : '') +
        ` Page: ${snippet}`,
    );
  }
}

async function dismissBlockingOverlays(page: Page) {
  // Close sync-attention drawer if an earlier step opened it.
  const syncClose = page.getByRole('button', { name: /^close$/i }).first();
  if (await page.getByText(/Sync Attention Required/i).isVisible().catch(() => false)) {
    await syncClose.click({ timeout: 3_000 }).catch(() => undefined);
  }

  // Shift-end / crew-capture / similar z-[110] backdrops block rail logout.
  for (let attempt = 0; attempt < 4; attempt++) {
    const backdrop = page.locator('div.fixed.inset-0.z-\\[110\\]').first();
    if (!(await backdrop.isVisible().catch(() => false))) return;

    const remind = page.getByRole('button', { name: /remind me later/i }).first();
    if (await remind.isVisible().catch(() => false)) {
      await remind.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      continue;
    }

    const dismiss = page
      .getByRole('button', { name: /skip|snooze|dismiss|cancel|close|not now/i })
      .first();
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      continue;
    }

    // Soft-mandatory overlays: backdrop click snoozes / reminds later.
    await backdrop.click({ force: true, timeout: 3_000 }).catch(() => undefined);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(300);
  }

  await page
    .locator('div.fixed.inset-0.z-\\[110\\]')
    .first()
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => undefined);
}

test.describe('Staging smoke', () => {
  test('health endpoint is ok', async ({ request }) => {
    const res = await request.get('/health');
    if (!res.ok()) {
      const text = await res.text();
      throw new Error(
        `Health check failed with status ${res.status()}: ${text.slice(0, 200)}.${cdnHint(res.status())}`,
      );
    }
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  // Nginx must preserve /auth URI and strip /api for Express (variable proxy_pass bugs → 404).
  test('auth and api routes are reachable (not routing 404)', async ({ request }) => {
    const refresh = await request.post('/auth/session/refresh', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(
      refresh.status(),
      `POST /auth/session/refresh must not be 404 (got ${refresh.status()}).${cdnHint(refresh.status())}`,
    ).not.toBe(404);

    const badgePin = await request.post('/auth/badge-pin', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(
      badgePin.status(),
      `POST /auth/badge-pin must not be 404 (got ${badgePin.status()}).${cdnHint(badgePin.status())}`,
    ).not.toBe(404);

    for (const path of ['/api/shifts/current', '/api/6hi/queue', '/api/tenant-flags']) {
      const res = await request.get(path);
      expect(
        res.status(),
        `GET ${path} must not be routing 404 (got ${res.status()}; 401/403 OK without session).${cdnHint(res.status())}`,
      ).not.toBe(404);
    }
  });

  test('login → dashboard → orders → create order UI → shift summary → reports → logout', async ({
    page,
  }) => {
    test.setTimeout(120_000);
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

    // Logout — clear shift-end / crew modals that cover the rail, then wait out handover spinner.
    await dismissBlockingOverlays(page);
    await page
      .getByText(/Checking handover status/i)
      .waitFor({ state: 'hidden', timeout: 20_000 })
      .catch(() => undefined);

    const logout = page.getByRole('button', { name: /log ?out|sign out|end session/i }).first();
    if (await logout.count()) {
      await dismissBlockingOverlays(page);
      await logout.click({ timeout: 15_000 });
      const confirmBtn = page.getByRole('dialog').getByRole('button', { name: /^logout$/i });
      try {
        await confirmBtn.waitFor({ state: 'visible', timeout: 3_000 });
        await confirmBtn.click();
      } catch {
        // No confirmation modal
      }
      try {
        await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
      } catch {
        await page.goto('/login');
      }
      await expect(page.getByPlaceholder(/badge/i)).toBeVisible({ timeout: 15_000 });
    } else {
      await page.goto('/login');
      await expect(page.getByPlaceholder(/badge/i)).toBeVisible();
    }
  });
});
