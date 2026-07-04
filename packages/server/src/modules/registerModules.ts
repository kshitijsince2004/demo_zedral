import { ModuleRegistry } from '@zedral/platform';
import { registerM1Module } from './m1-collection/register';

export function buildModuleRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  registerM1Module(registry);
  return registry;
}
