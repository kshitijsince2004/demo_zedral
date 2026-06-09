import { db } from '../db';

export class TraceabilityService {
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
        const stoppages = await db.selectFrom('txn.stoppage_entry as se')
          .innerJoin('master.stoppage_code as sc', 'se.stoppage_code', 'sc.stoppage_code')
          .select(['se.time_from', 'se.time_to', 'se.duration_min', 'se.remarks', 'sc.description'])
          .where('se.shift_log_id', '=', record.shift_log_id)
          .execute();
        
        history.push({ process: 'PKL', coilNo, record, stoppages });
      }

      // Cold Rolling Mill (CRM)
      const crm = await db.selectFrom('txn.prod_crm').selectAll().where('coil_no', '=', coilNo).execute();
      crm.forEach(record => history.push({ process: 'CRM', coilNo, record }));

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

      // Skin Pass (SKP)
      const skp = await db.selectFrom('txn.prod_skp').selectAll().where('coil_no', '=', coilNo).execute();
      skp.forEach(record => history.push({ process: 'SKP', coilNo, record }));

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
