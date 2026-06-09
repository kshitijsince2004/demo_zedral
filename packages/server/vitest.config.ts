import { defineConfig, mergeConfig } from 'vitest/config';
import unitConfig from './vitest.unit.config';

/** Default vitest entry — runs unit tests (no PostgreSQL required). */
export default mergeConfig(unitConfig, defineConfig({}));
