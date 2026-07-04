import type { ModuleCode, ModuleManifest } from './types';

export class ModuleRegistry {
  private readonly modules = new Map<ModuleCode, ModuleManifest>();

  register(manifest: ModuleManifest): void {
    if (this.modules.has(manifest.code)) {
      throw new Error(`Module already registered: ${manifest.code}`);
    }

    for (const dependency of manifest.dependsOn) {
      if (!this.modules.has(dependency)) {
        throw new Error(`Module ${manifest.code} depends on unregistered module ${dependency}`);
      }
    }

    this.modules.set(manifest.code, manifest);
  }

  get(code: ModuleCode): ModuleManifest | undefined {
    return this.modules.get(code);
  }

  require(code: ModuleCode): ModuleManifest {
    const manifest = this.get(code);
    if (!manifest) {
      throw new Error(`Module not registered: ${code}`);
    }
    return manifest;
  }

  list(): readonly ModuleManifest[] {
    return Array.from(this.modules.values());
  }
}
