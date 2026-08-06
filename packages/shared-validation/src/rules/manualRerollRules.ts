import { z } from 'zod';

export const ManualRerollMachineSchema = z.enum(['6HI', '4HI', '2HI']);

export const ManualRerollStartSchema = z.object({
  machine: ManualRerollMachineSchema,
  batchNumber: z.string().trim().min(1),
  batchNumbers: z.array(z.string().trim().min(1)).max(30).optional(),
  orderId: z.union([z.string(), z.number()]).optional(),
  rerollQuantity: z.number().positive().optional(),
  remarks: z.string().trim().max(2000).optional(),
});

export const ManualRerollEndSchema = z.object({
  machine: ManualRerollMachineSchema.optional(),
  remarks: z.string().trim().max(2000).optional(),
});

export const ManualRerollRemarkSchema = z.object({
  machine: ManualRerollMachineSchema,
  remarks: z.string().trim().max(2000),
});

/** Hold requires a free-text reason (same shape as remark). */
export const ManualRerollHoldSchema = ManualRerollRemarkSchema;

export const ManualRerollStoppageStartSchema = z.object({
  machine: ManualRerollMachineSchema,
  categoryCode: z.string().trim().min(1).max(64),
  stoppageCode: z.string().trim().max(64).optional(),
  remarks: z.string().trim().max(2000).optional(),
});

export const ManualRerollStoppageUpdateSchema = z.object({
  machine: ManualRerollMachineSchema,
  categoryCode: z.string().trim().min(1).max(64),
  stoppageCode: z.string().trim().max(64).optional(),
  remarks: z.string().trim().max(2000).optional(),
});

export const ManualRerollSummarySchema = z.object({
  machine: ManualRerollMachineSchema,
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  shift: z.string().trim().min(1).optional(),
});

export type ManualRerollMachine = z.infer<typeof ManualRerollMachineSchema>;
export type ManualRerollStart = z.infer<typeof ManualRerollStartSchema>;
export type ManualRerollEnd = z.infer<typeof ManualRerollEndSchema>;
export type ManualRerollSummaryQuery = z.infer<typeof ManualRerollSummarySchema>;
