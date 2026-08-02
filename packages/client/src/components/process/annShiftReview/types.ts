export type AnnShiftReviewPayload = {
  shiftLogId: string;
  process: Array<{
    base_no: string | null;
    charge_no: string;
    annealing_batch_no: string | null;
    grade_code: string | null;
    no_of_coils: number | null;
    charge_wt_mt: number | string | null;
    status: string | null;
    exp_unloading_time: string | null;
    unloading_wt_mt: number | string | null;
    temp: number | string | null;
    furnace_id: number | null;
  }>;
  stoppages: Array<{
    charge_no: string;
    category_code: string;
    category_label?: string | null;
    reason: string | null;
    remark: string | null;
    duration_min: number | string | null;
  }>;
  delaySummary: Array<{ bucket: string; minutes: number }>;
  totalDelayMin?: number;
  remarks: string | null;
  crew: {
    operatorEngineer: string;
    helper: string;
    craneOperator: string;
    shiftIncharge: string;
    signature: string;
  };
  production: { unloadMt: number; loadMt: number };
  dew: { n2: number | string | null; h2: number | string | null };
  inProcess: { forAnn: number; rw: number; inProcess: number; total: number };
  cumulative: { unloadMt: number; loadMt: number };
};
