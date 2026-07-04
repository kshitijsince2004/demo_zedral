export const canonicalEntityRegistry = {
  productionCount: 'canon.production_count',
  event: 'canon.event',
  equipmentNode: 'canon.equipment_node',
  costRate: 'canon.cost_rate',
  personnel: 'canon.personnel',
} as const;

export type CanonicalEntityName = keyof typeof canonicalEntityRegistry;
