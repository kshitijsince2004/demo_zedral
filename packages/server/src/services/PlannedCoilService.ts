import { withTenantContext } from '../db';

export class PlannedCoilService {
  static async getPlannedCoilsByProcess(processCode: string) {
    return await withTenantContext(async (trx) => {
      return await trx.selectFrom('planning.coil_plan as cp')
        .innerJoin('coil.coil as c', 'cp.coil_no', 'c.coil_no')
        .innerJoin('master.process as p', 'cp.planned_process_id', 'p.process_id')
        .select([
          'c.coil_no',
          'c.grade_code',
          'c.nominal_width_mm',
          'c.coil_thk_mm',
          'c.weight_mt',
          'c.customer_id',
          'c.status',
          'cp.seq_no'
        ])
        .where('p.code', '=', processCode)
        .where('c.status', 'in', ['PLANNED', 'IN_PROCESS', 'DONE'])
        .orderBy('cp.seq_no', 'asc')
        .execute();
    });
  }
}
