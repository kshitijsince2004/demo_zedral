import { withTenantContext } from '../db';
import { randomUUID } from 'crypto';

export class DeviceRegistrationService {
  static async registerDevice(processCode: string): Promise<string> {
    return await withTenantContext(async (trx) => {
      const deviceId = randomUUID();
      
      await trx.insertInto('security.device_registration')
        .values({
          device_id: deviceId,
          process_code: processCode,
          registered_at: new Date(),
          last_heartbeat: new Date()
        })
        .execute();
        
      return deviceId;
    });
  }

  static async getDeviceByProcess(processCode: string) {
    return await withTenantContext(async (trx) => {
      return await trx.selectFrom('security.device_registration')
        .selectAll()
        .where('process_code', '=', processCode)
        .executeTakeFirst();
    });
  }
}
