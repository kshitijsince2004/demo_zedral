import type { ModuleRegistry, ModuleScheduler } from '@zedral/platform';

export interface ModuleRuntime {
  stop(): Promise<void>;
}

export async function startModuleRuntime(registry: ModuleRegistry): Promise<ModuleRuntime> {
  const schedulers: ModuleScheduler[] = registry
    .list()
    .flatMap((manifest) => [...manifest.getSchedulers()]);

  for (const scheduler of schedulers) {
    await scheduler.start();
  }

  return {
    async stop() {
      for (const scheduler of [...schedulers].reverse()) {
        await scheduler.stop();
      }
    },
  };
}
