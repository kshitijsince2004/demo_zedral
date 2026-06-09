import { beforeEach } from 'vitest';
import { resetRateLimitStoreForTests } from '../src/middleware/rateLimitMiddleware';

beforeEach(() => {
  resetRateLimitStoreForTests();
});
