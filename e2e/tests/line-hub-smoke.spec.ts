import { test, expect } from '@playwright/test';

/**
 * Per-line hub smoke (capture → submit → handover still needs seeded plant data).
 * Set LINE_E2E=1 against a running stack with demo operator scope.
 */
const LINES = [
  { name: 'HRS', path: '/process/hrs', hint: /HR|Slit|HRS|Orders/i },
  { name: 'PKL', path: '/process/pkl', hint: /Pickl|PKL|Orders/i },
  { name: 'ANN', path: '/process/ann', hint: /Anneal|ANN|Orders|Charge/i },
  { name: 'ROLLING', path: '/process/crm', hint: /Roll|6HI|4HI|2HI|Orders/i },
  { name: 'RWD', path: '/process/rwd', hint: /Rewind|RWD|Orders/i },
] as const;

test.describe('Line hub smoke', () => {
  test.skip(!process.env.LINE_E2E, 'Set LINE_E2E=1 with a seeded operator session to run');

  for (const line of LINES) {
    test(`${line.name} hub loads`, async ({ page }) => {
      await page.goto(line.path);
      await expect(page.locator('body')).toContainText(line.hint, { timeout: 30_000 });
    });
  }
});
