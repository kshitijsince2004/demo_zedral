import { z } from 'zod';
import { ProcessSchemas, AdditionalSchemas } from './fieldRules';

export interface FieldDescriptor {
  fieldId: string; // e.g. "PKL.lineSpeedMpm"
  process: string;
  property: string;
  dataType: 'number' | 'string' | 'boolean' | 'unknown';
  unit?: string;
}

const unitMap: Record<string, string> = {
  Mm: 'mm',
  Mt: 'MT',
  Mpm: 'm/min',
  DegC: '°C',
  Pct: '%',
  Kg: 'kg',
  Nmm2: 'N/mm²',
  Um: 'µm',
  KgCm2: 'kg/cm²'
};

function inferUnit(prop: string): string | undefined {
  for (const [suffix, unit] of Object.entries(unitMap)) {
    if (prop.endsWith(suffix)) return unit;
  }
  return undefined;
}

function getZodType(schema: z.ZodTypeAny): string {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
    s = s.unwrap();
  }
  if (s instanceof z.ZodNumber) return 'number';
  if (s instanceof z.ZodString) return 'string';
  if (s instanceof z.ZodBoolean) return 'boolean';
  if (s instanceof z.ZodEnum || s instanceof z.ZodNativeEnum || s instanceof z.ZodLiteral) return 'string';
  return 'unknown';
}

const registryMap = new Map<string, FieldDescriptor>();

function extractFields(prefix: string, schema: z.ZodTypeAny) {
  let objSchema = schema;
  while (objSchema instanceof z.ZodEffects) {
    objSchema = objSchema.innerType();
  }
  if (objSchema instanceof z.ZodObject) {
    const shape = objSchema.shape;
    for (const [prop, propSchema] of Object.entries(shape)) {
      const type = getZodType(propSchema as z.ZodTypeAny);
      if (type !== 'unknown') {
        const fieldId = `${prefix}.${prop}`;
        registryMap.set(fieldId, {
          fieldId,
          process: prefix,
          property: prop,
          dataType: type as any,
          unit: inferUnit(prop)
        });
      }
    }
  }
}

for (const [process, schema] of Object.entries(ProcessSchemas)) {
  extractFields(process, schema);
}
for (const [schemaKey, schema] of Object.entries(AdditionalSchemas)) {
  extractFields(schemaKey, schema);
}

export const FIELD_REGISTRY = Array.from(registryMap.values());

export function isKnownField(fieldId: string): boolean {
  return registryMap.has(fieldId);
}

export function getFieldDescriptor(fieldId: string): FieldDescriptor | undefined {
  return registryMap.get(fieldId);
}
