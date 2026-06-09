const fs = require('fs');

let content = fs.readFileSync('packages/server/src/services/shiftLogService.ts', 'utf8');

const handoverCode = `
  static getNextShift(currentShiftCode: string, currentDate: Date): { nextShiftCode: string, nextProdDate: Date } {
    let nextShiftCode = '';
    let nextProdDate = new Date(currentDate);

    if (currentShiftCode === 'A') {
      nextShiftCode = 'B';
    } else if (currentShiftCode === 'B') {
      nextShiftCode = 'C';
    } else if (currentShiftCode === 'C') {
      nextShiftCode = 'A';
      nextProdDate.setDate(nextProdDate.getDate() + 1);
    } else {
      nextShiftCode = currentShiftCode;
    }

    return { nextShiftCode, nextProdDate };
  }

  static getProcessTable(processId: number): string | null {
    const map: Record<number, string> = {
      1: 'txn.prod_hrs',
      2: 'txn.prod_pkl',
      3: 'txn.prod_crm',
      4: 'txn.ann_charge',
      5: 'txn.prod_skp',
      6: 'txn.prod_rwd',
      7: 'txn.prod_crs',
      8: 'txn.prod_ctl',
      9: 'txn.prod_glv'
    };
    return map[processId] || null;
  }

  static async handover(currentShiftLogId: string, incomingUserId: number, notes?: string) {
    const currentLog = await this.getById(currentShiftLogId);
    if (!currentLog) {
      throw new Error('Current shift log not found');
    }
    if (currentLog.state !== ShiftLogState.DRAFT && currentLog.state !== ShiftLogState.REOPENED) {
      throw new Error('Shift log must be DRAFT to perform handover');
    }

    const { nextShiftCode, nextProdDate } = this.getNextShift(currentLog.shift_code, currentLog.prod_date);

    return await db.transaction().execute(async (trx) => {
      // 1. Close current shift
      await trx.updateTable('txn.shift_log')
        .set({ state: ShiftLogState.SUBMITTED, submitted_at: new Date() })
        .where('shift_log_id', '=', String(currentShiftLogId))
        .execute();

      // 2. Create new shift
      const newShift = await trx.insertInto('txn.shift_log')
        .values({
          process_id: currentLog.process_id,
          prod_date: nextProdDate,
          shift_code: nextShiftCode,
          mill_type: currentLog.mill_type,
          shift_manager_id: incomingUserId,
          prev_shift_log_id: String(currentShiftLogId),
          state: ShiftLogState.DRAFT
        })
        .returning('shift_log_id')
        .executeTakeFirstOrThrow();
      
      const newShiftLogId = newShift.shift_log_id;

      // 3. Repoint open stoppages
      await trx.updateTable('txn.stoppage_entry')
        .set({ shift_log_id: newShiftLogId })
        .where('shift_log_id', '=', String(currentShiftLogId))
        .where('time_to', 'is', null)
        .execute();

      // 4. Repoint open coils
      const processTable = this.getProcessTable(currentLog.process_id);
      if (processTable) {
        if (processTable === 'txn.ann_charge') {
          await trx.updateTable('txn.ann_charge' as any)
            .set({ shift_log_id: newShiftLogId })
            .where('shift_log_id', '=', String(currentShiftLogId))
            .where('status', '=', 'IN_PROCESS')
            .execute();
        } else {
          await trx.updateTable(processTable as any)
            .set({ shift_log_id: newShiftLogId })
            .where('shift_log_id', '=', String(currentShiftLogId))
            .where('time_to', 'is', null)
            .execute();
        }
      }

      // 5. Store notes if requested (Since there is no notes field on shift_log, we skip or store in a separate log. 
      // For now we'll just return the new ID)

      return newShiftLogId;
    });
  }
`;

content = content.replace(/static async getById/g, handoverCode + '\n  static async getById');

fs.writeFileSync('packages/server/src/services/shiftLogService.ts', content);
console.log('Added handover logic to shiftLogService');
