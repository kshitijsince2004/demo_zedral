import type { Router } from 'express';

export type ModuleCode = string;

export interface ModuleScheduler {
  name: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface ModuleManifest {
  code: ModuleCode;
  name: string;
  dbSchema: string;
  featureFlag: string;
  mountPath: string;
  consumesEvents: readonly string[];
  producesEvents: readonly string[];
  consumesCanonical: readonly string[];
  dependsOn: readonly ModuleCode[];
  migrationsPath: string;
  createRouter(): Router;
  getSchedulers(): readonly ModuleScheduler[];
}
