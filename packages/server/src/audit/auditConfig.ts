/** Whether application-level audit writes should hit the database. */
export function isAuditPersistenceEnabled(): boolean {
  if (process.env.AUDIT_ENABLED === 'false') return false;
  if (process.env.NODE_ENV === 'test') return false;
  return true;
}
