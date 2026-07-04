export function validateServiceToken(authorizationHeader: string | undefined): boolean {
  const expected = process.env.SERVICE_TOKEN?.trim();
  if (!expected) return false;

  const [scheme, token] = (authorizationHeader ?? '').split(/\s+/);
  return scheme === 'Bearer' && token === expected;
}
