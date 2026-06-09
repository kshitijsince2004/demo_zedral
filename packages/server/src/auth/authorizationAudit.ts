import { AuditTrailService } from '../services/AuditTrailService';

export async function logAuthorizationDenied(
  userId: number,
  role: string,
  operation: string,
  context?: string,
): Promise<void> {
  await AuditTrailService.log(
    'security.authorization_denial',
    String(userId),
    'INSERT',
    null,
    { role, operation, context: context ?? null },
    userId,
  );
}
