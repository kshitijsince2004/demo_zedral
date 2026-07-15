import { db } from '../db';

export class TraceabilityService {
  /**
   * Resolves production identifiers (batch, coil, SAP order, etc.) and returns trace data.
   */
  static async search(query: string) {
    const q = query.trim();
    if (!q) throw new Error('Search query is required');

    const batch = await db.selectFrom('planning.ppc_batch as pb')
      .selectAll('pb')
      .where((eb) => eb.or([
        eb('pb.batch_number', 'ilike', q),
        eb('pb.coil_no', 'ilike', q),
        eb('pb.sap_order_no', 'ilike', q),
        eb('pb.slit_id', 'ilike', q),
      ]))
      .orderBy('pb.batch_id', 'desc')
      .executeTakeFirst();

    const coilFromBatch = batch?.coil_no ?? null;
    const tree = await this.getTraceabilityTree(coilFromBatch ?? q);

    let orderInfo: Record<string, unknown> | null = null;
    let machineJourney: Record<string, unknown>[] = [];

    if (batch) {
      const crmOrder = await db.selectFrom('txn.crm_order')
        .selectAll()
        .where('batch_id', '=', batch.batch_id)
        .executeTakeFirst();

      const coilNo = (crmOrder?.coil_no ?? batch.coil_no ?? '').trim() || null;
      const slitId = (crmOrder?.slit_id ?? batch.slit_id)?.trim() || null;
      orderInfo = {
        batchNumber: batch.batch_number,
        coilNo,
        motherCoil: coilNo,
        slitId,
        customer: batch.customer_name,
        grade: batch.grade_code,
        subProcess: batch.sub_process,
        machineCode: batch.machine_code,
        machineAllocated: batch.machine_allocated ?? false,
        planDate: batch.plan_date,
        shiftCode: batch.shift_code,
        weightMt: Number(batch.ppc_weight_mt),
        targetThkMm: Number(batch.ppc_thk_mm),
        inputThkMm: batch.input_thk_mm != null ? Number(batch.input_thk_mm) : null,
        sapOrderNo: batch.sap_order_no,
        status: crmOrder?.status ?? 'PENDING',
        importBatchId: batch.import_batch_id,
      };

      const journeySteps = await db.selectFrom('planning.order_journey_step as ojs')
        .select([
          'ojs.step_no as stepSeq',
          'ojs.process_code as processCode',
          'ojs.display_label as displayLabel',
          'ojs.machine_code as machineCode',
          'ojs.status as stepStatus',
          'ojs.completed_at as completedAt',
        ])
        .where('ojs.queue_batch_id', '=', batch.batch_id)
        .orderBy('ojs.step_no', 'asc')
        .execute();

      machineJourney = journeySteps.map((s) => ({
        step: s.stepSeq,
        process: s.processCode,
        machine: s.machineCode,
        status: s.stepStatus,
        completedAt: s.completedAt,
      }));
    }

    return {
      ...tree,
      orderInfo,
      machineJourney,
      searchedBy: q,
    };
  }

  /**
   * Retrieves the full traceability tree for a given coil or bundle number.
   * Steps backward from the query to the original HR coil.
   */
  static async getTraceabilityTree(query: string) {
    let targetCoilNo = query;

    // 1. If it looks like a bundle, try to find it in CTL remarks
    if (query.toUpperCase().startsWith('BNDL-')) {
      const ctlMatch = await db.selectFrom('txn.prod_ctl')
        .select('coil_no')
        .where('remarks', 'ilike', `%${query}%`)
        .executeTakeFirst();
      if (ctlMatch) {
        targetCoilNo = ctlMatch.coil_no;
      }
    }

    // 2. Fetch the lineage
    const lineage: string[] = [];
    let currentCoilNo: string | null = targetCoilNo;

    while (currentCoilNo) {
      lineage.push(currentCoilNo);
      const coil = await db.selectFrom('coil.coil')
        .select('parent_coil_no')
        .where('coil_no', '=', currentCoilNo)
        .executeTakeFirst();
      
      if (coil && coil.parent_coil_no) {
        currentCoilNo = coil.parent_coil_no;
      } else {
        currentCoilNo = null;
      }
    }

    if (lineage.length === 0) {
      throw new Error(`Coil or bundle not found for query: ${query}`);
    }

    // 3. Fetch history for all coils in lineage
    const history = [];

    for (const coilNo of lineage) {
      // HR Slitting (HRS)
      const hrs = await db.selectFrom('txn.prod_hrs').selectAll().where('coil_no', '=', coilNo).execute();
      hrs.forEach(record => history.push({ process: 'HRS', coilNo, record }));

      // Pickling (PKL)
      const pkl = await db.selectFrom('txn.prod_pkl').selectAll().where('coil_no', '=', coilNo).execute();
      for (const record of pkl) {
        // Find stoppages for this shift
        const stoppages = await db.selectFrom('txn.stoppage as se')
          .innerJoin('master.stoppage_code as sc', 'se.breakdown_code', 'sc.stoppage_code')
          .select(['se.start_at', 'se.end_at', 'se.duration_min', 'se.remarks', 'sc.description'])
          .where('se.shift_log_id', '=', record.shift_log_id)
          .execute();
        
        history.push({ process: 'PKL', coilNo, record, stoppages });
      }

      // Cold Rolling Mill 6HI (CRM6)
      const crm6 = await db.selectFrom('txn.crm_order as o')
        .leftJoin('txn.crm_rolling as r', 'o.order_id', 'r.order_id')
        .leftJoin('txn.crm_skinpass as s', 'o.order_id', 's.order_id')
        .select([
           'o.order_id',
           'o.coil_no',
           'o.sub_process',
           'o.status',
           'o.ppc_weight_mt',
           'r.actual_weight_mt as rolling_actual_weight_mt',
           'r.rerolling as rolling_rerolling_flag',
           's.actual_weight_mt as skinpass_actual_weight_mt'
        ])
        .where('o.coil_no', '=', coilNo)
        .execute();

      crm6.forEach(record => history.push({ 
         process: 'CRM6', 
         coilNo, 
         record: {
            ...record,
            actualWeightMt: record.sub_process === 'ROLLING' ? record.rolling_actual_weight_mt : record.skinpass_actual_weight_mt,
            rerolling: record.rolling_rerolling_flag
         }
      }));

      // Annealing (ANN)
      const annCoils = await db.selectFrom('txn.ann_charge_coil as acc')
        .innerJoin('txn.ann_charge as ac', 'acc.charge_no', 'ac.charge_no')
        .selectAll()
        .where('acc.coil_no', '=', coilNo)
        .execute();
        
      for (const record of annCoils) {
        // Fetch sibling coils
        const siblings = await db.selectFrom('txn.ann_charge_coil')
          .select('coil_no')
          .where('charge_no', '=', record.charge_no)
          .where('coil_no', '!=', coilNo)
          .execute();
        history.push({ process: 'ANN', coilNo, record, siblings: siblings.map(s => s.coil_no) });
      }

      // Rewinding (RWD)
      const rwd = await db.selectFrom('txn.prod_rwd').selectAll().where('coil_no', '=', coilNo).execute();
      rwd.forEach(record => history.push({ process: 'RWD', coilNo, record }));

      // CRS
      const crs = await db.selectFrom('txn.prod_crs').selectAll().where('coil_no', '=', coilNo).execute();
      crs.forEach(record => history.push({ process: 'CRS', coilNo, record }));

      // CTL
      const ctl = await db.selectFrom('txn.prod_ctl').selectAll().where('coil_no', '=', coilNo).execute();
      ctl.forEach(record => history.push({ process: 'CTL', coilNo, record }));
    }

    // Note: The history might not be perfectly chronological because we group by coil lineage,
    // but the lineage array goes from newest coil to oldest parent. We can reverse the lineage 
    // or just present them grouped by process.
    // For a real chronology, we'd need timestamps on every record, but we can infer ordering:
    // lineage is reverse chronological (Child -> Parent -> Grandparent).
    // Let's reverse the lineage so it's Parent -> Child, and process order is roughly HRS->PKL->CRM->ANN->SKP->RWD->CRS->CTL
    
    const processOrder: Record<string, number> = {
      'HRS': 1,
      'PKL': 2,
      'CRM': 3,
      'ANN': 4,
      'SKP': 5,
      'RWD': 6,
      'CRS': 7,
      'CTL': 8
    };

    history.sort((a, b) => {
      // First sort by lineage depth (older coils first)
      const depthA = lineage.indexOf(a.coilNo);
      const depthB = lineage.indexOf(b.coilNo);
      if (depthA !== depthB) {
        return depthB - depthA; // Reversed index, so deepest parent (highest index) comes first
      }
      // Then sort by process flow
      return processOrder[a.process] - processOrder[b.process];
    });

    return {
      query,
      targetCoilNo,
      lineage,
      history
    };
  }
}
