export interface CanonicalEventSchema {
  event: string;
  version: number;
  requiredPayloadFields: readonly string[];
}

export const canonicalEventSchemas: Record<string, CanonicalEventSchema> = {
  'shift.closed': {
    event: 'shift.closed',
    version: 1,
    requiredPayloadFields: ['shiftLogId', 'processId', 'totalProdMt', 'closedAt'],
  },
  'downtime.logged': {
    event: 'downtime.logged',
    version: 1,
    requiredPayloadFields: [
      'stoppageId',
      'shiftLogId',
      'stoppageCode',
      'category',
      'fromTime',
      'toTime',
      'durationMin',
      'prodDate',
      'lineageRef',
    ],
  },
  'production.counted': {
    event: 'production.counted',
    version: 1,
    requiredPayloadFields: ['countId', 'assetId', 'quantity', 'uom', 'countedAt', 'lineageRef'],
  },
  'production.captured': {
    event: 'production.captured',
    version: 1,
    requiredPayloadFields: ['processCode', 'shiftLogId', 'entryId', 'coilNo'],
  },
  'defect.logged': {
    event: 'defect.logged',
    version: 1,
    requiredPayloadFields: ['defectId', 'processId', 'entryId', 'defectCode'],
  },
} as const;

export function getCanonicalEventSchema(event: string): CanonicalEventSchema | undefined {
  return canonicalEventSchemas[event];
}

export function assertCanonicalEventCompatible(event: {
  type: string;
  version: number;
  payload: Readonly<Record<string, unknown>>;
}): void {
  const schema = getCanonicalEventSchema(event.type);
  if (!schema) {
    throw new Error(`Canonical event schema is not registered for ${event.type}`);
  }
  if (event.version !== schema.version) {
    throw new Error(`Canonical event ${event.type} version ${event.version} does not match registered version ${schema.version}`);
  }
  for (const field of schema.requiredPayloadFields) {
    if (!(field in event.payload) || event.payload[field] == null) {
      throw new Error(`Canonical event ${event.type} is missing required payload field ${field}`);
    }
  }
}
