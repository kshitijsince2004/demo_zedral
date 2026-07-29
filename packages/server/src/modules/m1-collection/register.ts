import { Router } from 'express';
import { m1ManifestMeta } from '@zedral/m1-collection';
import type { ModuleManifest, ModuleRegistry } from '@zedral/platform';

export function createM1Manifest(): ModuleManifest {
  return {
    ...m1ManifestMeta,
    createRouter: () => Router(),
    getSchedulers: () => [],
  };
}

export function registerM1Module(registry: ModuleRegistry): ModuleManifest {
  const manifest = createM1Manifest();
  registry.register(manifest);
  return manifest;
}

export { registerJourneyAdvanceConsumer } from './consumers/JourneyAdvanceConsumer';
