import { Workbook } from 'exceljs';
import { detectStructure } from './structureDetector';
import { buildBlankMaster } from './blankMasterBuilder';
import { DprTemplateRepository } from '../repositories/DprTemplateRepository';

export class ImportService {
  constructor(private templateRepo: DprTemplateRepository) {}

  async importTemplate(blob: Buffer): Promise<string> {
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(blob);
    } catch (e) {
      throw new Error('Invalid workbook: not a readable .xlsx file');
    }

    const mainSheet = workbook.worksheets[0];
    if (!mainSheet) {
      throw new Error('Validation failed: main sheet missing');
    }

    const structure = detectStructure(mainSheet);
    if (structure.blockStride <= 0) {
      throw new Error('Validation failed: DATE marker or block stride not found');
    }
    if (structure.lineMarkerRow < 0) {
      throw new Error('Validation failed: LINE marker not found');
    }

    const blankMasterBlob = await buildBlankMaster(workbook);

    const templateId = await this.templateRepo.create(
      blob,
      blankMasterBlob,
      { structure }
    );

    return templateId as any;
  }
}
