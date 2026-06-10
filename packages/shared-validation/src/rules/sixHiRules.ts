import { z } from 'zod';



export const SixHiSubProcessSchema = z.enum(['ROLLING', 'SKIN_PASS']);



export const SixHiDestinationSchema = z.enum(['REWINDING', 'ANNEALING']);



export const SixHiRollFinishSchema = z.enum(['MATT', 'BRIGHT', 'LOW_MATT']);



export const SixHiOperatingModeSchema = z.enum(['LOAD', 'STRETCH']);



export const SixHiPassSchema = z.object({

  passNo: z.number().int().positive(),

  thicknessMm: z.number().positive().refine((val) => {
    const s = val.toString();
    if (!s.includes('.')) return true;
    const dp = s.split('.')[1].length;
    return dp >= 2 && dp <= 4;
  }, { message: 'Must have 2-4 decimal places' }),
});



export const SixHiRollingUpdateSchema = z.object({

  actualWeightMt: z.number().positive().optional(),

  destination: SixHiDestinationSchema,

  destinationOverride: z.boolean().optional(),

  associateRw: z.string().optional(),

  etr: z.number().optional(),

  dtr: z.number().optional(),

  passes: z.array(SixHiPassSchema).min(0),

});



export const SixHiSkinPassUpdateSchema = z
  .object({

    actualWeightMt: z.number().positive().optional(),

    outputThkMm: z.number().positive().optional(),

    annHard: z.number().optional(),

    rwTension1: z.number().optional(),

    rwTension2: z.number().optional(),

    operatingMode: SixHiOperatingModeSchema.optional(),

    loadMinT: z.number().optional(),

    loadMaxT: z.number().optional(),

    stretchPct: z.number().optional(),

  })
  .refine(
    (data) => {
      const hasAnn = data.annHard != null;
      const hasRw = data.rwTension1 != null || data.rwTension2 != null;
      return !(hasAnn && hasRw);
    },
    { message: 'Provide either Annealing Hardness or R/W Tension, not both' },
  );



export const SixHiOrderStoppageSchema = z.object({

  categoryCode: z.string().min(1),

  breakdownCode: z.string().optional(),

  remarks: z.string().optional(),

});



export const SixHiRemarkDefectSchema = z.object({
  defectCode: z.string().min(1),
  quantityAffected: z.number().min(0).optional(),
  remarks: z.string().max(500).optional(),
});

export const SixHiRemarkSchema = z.object({
  text: z.string().min(1).max(500),
  defects: z.array(SixHiRemarkDefectSchema).optional(),
});

export const SixHiRejectionReasonSchema = z.enum([
  'QUALITY_ISSUE',
  'DEFECT_FOUND',
  'MATERIAL_ISSUE',
  'CUSTOMER_REQUIREMENT_FAILURE',
  'OTHER',
]);



export const SixHiRollChangeSchema = z.object({

  rollPosition: z.enum(['IN', 'OUT']),

  newRollNo: z.string().min(1),

  newRollCode: z.string().optional(),

  reasonText: z.string().max(100).optional(),

});



export const SixHiShiftSummarySchema = z.object({

  scrapKg: z.number().min(0).optional(),

  coolantTempDegC: z.number().optional(),

  coolantPressKgCm2: z.number().optional(),

});



/** Manual operator entry — same shape as PPC import row */
export const SixHiManualOrderSchema = z.object({

  batch_number: z.string().min(1),

  plan_date: z.string().min(1),

  shift_code: z.string().min(1),

  machine_code: z.string().min(1),

  sub_process: z.enum(['ROLLING', 'SKIN_PASS']),

  coil_no: z.string().min(1),

  slit_id: z.string().optional(),

  customer_name: z.string().min(1),

  grade_code: z.string().min(1),

  width_mm: z.number().positive(),

  input_thk_mm: z.number().positive().optional(),

  ppc_thk_mm: z.number().positive(),

  ppc_weight_mt: z.number().positive(),

  destination: z.enum(['ANNEALING', 'REWINDING']).optional(),

  roll_finish: z.string().optional(),

  ppc_reroll_flag: z.boolean().optional(),

  queue_seq: z.number().int().optional(),

  sap_order_no: z.string().optional(),

  process_route: z.string().optional(),

});

export const PPCImportRowSchema = z.object({

  batch_number: z.string().min(1),

  plan_date: z.string().min(1),

  shift_code: z.string().min(1),

  machine_code: z.string().min(1),

  sub_process: z.string().min(1),

  coil_no: z.string().min(1),

  slit_id: z.string().optional(),

  customer_name: z.string().min(1),

  grade_code: z.string().min(1),

  width_mm: z.number().positive(),

  input_thk_mm: z.number().positive().optional(),

  ppc_thk_mm: z.number().positive(),

  ppc_weight_mt: z.number().positive(),

  destination: z.string().optional(),

  roll_finish: z.string().optional(),

  ppc_reroll_flag: z.boolean().optional(),

  queue_seq: z.number().int().optional(),

  sap_order_no: z.string().optional(),

  process_route: z.string().optional(),

});

