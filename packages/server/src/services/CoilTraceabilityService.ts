import { db } from '../db';

export class CoilTraceabilityService {
  /**
   * Registers a new coil in the master tracking table.
   */
  static async registerCoil(coilNumber: string, initialProcess: string) {
    await db.insertInto('txn.coils' as any).values({
      coil_number: coilNumber,
      status: 'PLANNED',
      current_process_id: initialProcess,
      created_at: new Date(),
      updated_at: new Date()
    }).execute();
  }

  /**
   * Records a processing step in the coil_process_history table, and updates the core coil status.
   */
  static async recordProcessStep(
    coilNumber: string, 
    processId: string, 
    payload: any, 
    userId: string
  ) {
    // 1. Record history
    await db.insertInto('txn.coil_process_history' as any).values({
      coil_number: coilNumber,
      process_id: processId,
      entry_timestamp: new Date(),
      completion_timestamp: new Date(), // Simulating instant completion for the POST body
      input_thickness: payload.inputThickness || payload.thickness,
      output_thickness: payload.outputThickness || payload.thickness,
      output_weight_mt: payload.weightMt,
      recorded_by: userId
    }).execute();

    // 2. Update parent coil status to DONE for this process
    await db.updateTable('txn.coils' as any)
      .set({ 
        status: 'DONE', 
        updated_at: new Date() 
      })
      .where('coil_number', '=', coilNumber)
      .execute();
  }

  /**
   * Overrides or explicitly sets the status of a coil.
   */
  static async updateCoilStatus(coilNumber: string, status: 'PLANNED' | 'IN_PROCESS' | 'HOLD' | 'REWORK' | 'DONE' | 'SCRAPPED') {
    await db.updateTable('txn.coils' as any)
      .set({ 
        status, 
        updated_at: new Date() 
      })
      .where('coil_number', '=', coilNumber)
      .execute();
  }
}
