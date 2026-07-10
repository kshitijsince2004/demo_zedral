import { SixHiService } from '../SixHiService';

export class SixHiQueueService {
  static getQueue(
    ...args: Parameters<typeof SixHiService.getQueue>
  ): ReturnType<typeof SixHiService.getQueue> {
    return SixHiService.getQueue(...args);
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
