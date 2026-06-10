import { DprEntryRepository } from '../repositories/DprEntryRepository';
import { DprMonthRepository } from '../repositories/DprMonthRepository';
import { FieldProvenance } from '../dprTypes';

export class DailyEntryService {
  constructor(
    private entryRepo: DprEntryRepository,
    private monthRepo: DprMonthRepository
  ) {}

  async saveDay(monthId: string, dayNumber: number, inputs: any, delayData: any, overrides: string[]) {
    if (dayNumber > 1) {
      const allEntries = await this.entryRepo.getEntriesForMonth(monthId);
      const prevDayExists = allEntries.some(e => e.day_number === dayNumber - 1);
      if (!prevDayExists) {
        throw new Error(`Cannot save day ${dayNumber} without saving day ${dayNumber - 1} first.`);
      }
    }

    const values: any = {};
    const provenance: any = {};
    
    for (const [key, val] of Object.entries(inputs)) {
      if (val === '' || val === null) {
        values[key] = 0;
        provenance[key] = FieldProvenance.Manual;
      } else {
        values[key] = Number(val);
        provenance[key] = overrides.includes(key) ? FieldProvenance.Manual : FieldProvenance.AutoSourced;
      }
    }

    await this.entryRepo.saveEntry(monthId, dayNumber, values, delayData, provenance);
  }

  async getDayStatus(monthId: string, dayNumber: number) {
    const allEntries = await this.entryRepo.getEntriesForMonth(monthId);
    const entry = allEntries.find(e => e.day_number === dayNumber);
    return entry ? 'entered' : 'zero';
  }

  async startNewMonth(templateId: string, year: number, month: number, sheetCode: string, daysInMonth: number, configOverrides: any) {
    return await this.monthRepo.create(templateId, year, month, sheetCode, daysInMonth, configOverrides);
  }
}
