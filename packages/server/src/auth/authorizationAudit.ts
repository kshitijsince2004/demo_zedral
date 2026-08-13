import { AuditTrailService } from '../services/AuditTrailService';
import { isAuditPersistenceEnabled } from '../audit/auditConfig';
import { logger } from '../utils/logger';

export async function logAuthorizationDenied(
  userId: number,
  role: string,
  operation: string,
  context?: string,
): Promise<void> {
  if (!isAuditPersistenceEnabled()) {
    return;
  }

  try {
    await AuditTrailService.log(
      'security.authorization_denial',
      String(userId),
      'INSERT',
      null,
      { role, operation, context: context ?? null },
      userId,
    );
  } catch (err) {
    logger.error('Failed to persist authorization denial audit', err);
  }
}
