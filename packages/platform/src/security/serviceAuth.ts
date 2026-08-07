import { timingSafeEqual } from 'crypto';

/** Shift codes earlier in the same production day (A→B→C cycle). */
export function earlierShiftCodesOnSameDay(shiftCode: string): string[] {
  const order = ['A', 'B', 'C'];
  const idx = order.indexOf(shiftCode.toUpperCase());
  if (idx <= 0) return [];
  return order.slice(0, idx);
}

function safeTokenEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseBearerToken(authorizationHeader: string | undefined): string | null {
  const [scheme, token] = (authorizationHeader ?? '').split(/\s+/);
  if (scheme !== 'Bearer' || !token?.trim()) return null;
  return token.trim();
}

/** tenantId → service token (from SERVICE_TOKEN_MAP JSON or SERVICE_TOKEN + SERVICE_TOKEN_TENANT_ID). */
export function loadServiceTokenByTenant(): Map<string, string> {
  const map = new Map<string, string>();
  const rawMap = process.env.SERVICE_TOKEN_MAP?.trim();
  if (rawMap) {
    try {
      const parsed = JSON.parse(rawMap) as Record<string, string>;
      for (const [tenantId, token] of Object.entries(parsed)) {
        if (typeof token === 'string' && token.trim() && tenantId.trim()) {
          map.set(tenantId.trim(), token.trim());
        }
      }
      return map;
    } catch {
      return map;
    }
  }

  const token = process.env.SERVICE_TOKEN?.trim();
  const tenantId =
    process.env.SERVICE_TOKEN_TENANT_ID?.trim() || process.env.TENANT_ID?.trim();
  if (token && tenantId) map.set(tenantId, token);
  return map;
}

/**
 * Validates Bearer service token and returns the bound tenant id when valid.
 * When requestedTenantId is supplied it must match the token's tenant binding.
 */
export function resolveServiceTokenTenant(
  authorizationHeader: string | undefined,
  requestedTenantId?: string,
): string | null {
  const token = parseBearerToken(authorizationHeader);
  if (!token) return null;

  const byTenant = loadServiceTokenByTenant();
  for (const [tenantId, expected] of byTenant.entries()) {
    if (safeTokenEqual(token, expected)) {
      if (requestedTenantId && requestedTenantId !== tenantId) return null;
      return tenantId;
    }
  }
  return null;
}

export function validateServiceToken(authorizationHeader: string | undefined): boolean {
  return resolveServiceTokenTenant(authorizationHeader) !== null;
}
