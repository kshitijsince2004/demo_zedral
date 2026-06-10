import { Workbook } from 'exceljs';
import { DprTemplateRepository } from '../repositories/DprTemplateRepository';
import { DprMonthRepository } from '../repositories/DprMonthRepository';
import { DprEntryRepository } from '../repositories/DprEntryRepository';
import { applyMonthIdentity } from './monthIdentity';
import { trimTrailingBlocks } from './blockTrimmer';

export class ExportEngine {
  constructor(
    private templateRepo: DprTemplateRepository,
    private monthRepo: DprMonthRepository,
    private entryRepo: DprEntryRepository
  ) {}

  async exportMonth(monthId: string): Promise<Buffer> {
    const month = await this.monthRepo.findById(monthId);
    if (!month) throw new Error('Month not found');

    const template = await this.templateRepo.findById(month.template_id);
    if (!template) throw new Error('Template not found');

    const entries = await this.entryRepo.getEntriesForMonth(monthId);

    const workbook = new Workbook();
    await workbook.xlsx.load(template.blank_master_blob);

    const mainSheet = workbook.getWorksheet(1);
    const delaySheet = workbook.getWorksheet('DELAY');

    if (mainSheet && delaySheet) {
      applyMonthIdentity(mainSheet, delaySheet, month.year, month.month);
      trimTrailingBlocks(mainSheet, month.days_in_month);
    }

    return (await workbook.xlsx.writeBuffer()) as any;
  }
}
