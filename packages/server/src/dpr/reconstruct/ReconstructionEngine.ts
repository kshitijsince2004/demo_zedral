import { Workbook } from 'exceljs';
import { buildDelaySheet } from './delaySheet';
import { verifyReconstruction } from './verification';

export class ReconstructionEngine {
  async reconstruct(): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.addWorksheet('MAIN');
    buildDelaySheet(workbook);

    const isValid = verifyReconstruction(workbook);
    if (!isValid) {
      throw new Error('Reconstruction verification failed closed');
    }

    return (await workbook.xlsx.writeBuffer()) as Buffer;
  }
}
