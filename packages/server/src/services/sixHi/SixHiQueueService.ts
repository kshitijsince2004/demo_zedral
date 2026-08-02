import { SixHiService } from '../SixHiService';
import { RewindingOrderService } from '../RewindingOrderService';

export class SixHiQueueService {
  static getQueue(
    ...args: Parameters<typeof SixHiService.getQueue>
  ): ReturnType<typeof SixHiService.getQueue> {
    return SixHiService.getQueue(...args);
  }

  /** Delegate to rwd_order queue — legacy /6hi/rewinding-queue stays shape-compatible. */
  static async getRewindingQueue(machineCode = '2HI') {
    const result = await RewindingOrderService.getQueue(machineCode);
    return {
      machineCode: result.machineCode,
      queue: result.queue.map((c) => ({
        batchNumber: c.batchNumber,
        coilNo: c.coilNo,
        displayCoilNo: c.displayCoilNo,
        slitId: c.slitId,
        customerName: c.customerName,
        gradeCode: c.gradeCode,
        widthMm: c.widthMm,
        thicknessMm: c.thicknessMm,
        weightMt: c.weightMt,
        surfaceFinish: c.surfaceFinish,
        planDate: c.planDate,
        shiftCode: c.shiftCode,
      })),
    };
  }

  static allocateMachine(
    ...args: Parameters<typeof SixHiService.allocateMachine>
  ): ReturnType<typeof SixHiService.allocateMachine> {
    return SixHiService.allocateMachine(...args);
  }

  static getOrderAssignmentBoard(
    ...args: Parameters<typeof SixHiService.getOrderAssignmentBoard>
  ): ReturnType<typeof SixHiService.getOrderAssignmentBoard> {
    return SixHiService.getOrderAssignmentBoard(...args);
  }
}
