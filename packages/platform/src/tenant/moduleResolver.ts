export interface TenantModuleConfig {
  enabledModules: readonly string[];
  flags: Readonly<Record<string, boolean>>;
}

export function isModuleActive(
  moduleCode: string,
  featureFlag: string,
  config: TenantModuleConfig,
): boolean {
  const flagValue = config.flags[featureFlag];
  if (flagValue === false) return false;

  if (config.enabledModules.length === 0) {
    return true;
  }

  return config.enabledModules.includes(moduleCode);
}

export function resolveActiveModules(
  registeredModules: readonly string[],
  config: TenantModuleConfig,
): readonly string[] {
  if (config.enabledModules.length === 0) {
    return registeredModules.filter((code) => config.flags[`module.${code.toLowerCase()}`] !== false);
  }

  return registeredModules.filter((code) => config.enabledModules.includes(code));
}
