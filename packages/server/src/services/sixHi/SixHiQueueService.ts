import { SixHiService } from '../SixHiService';

export class SixHiQueueService {
  static resolveMachinePlanContexts(
    ...args: Parameters<typeof SixHiService.resolveMachinePlanContexts>
  ): ReturnType<typeof SixHiService.resolveMachinePlanContexts> {
    return SixHiService.resolveMachinePlanContexts(...args);
  }

  static resolveMachinePlanContext(
    ...args: Parameters<typeof SixHiService.resolveMachinePlanContext>
  ): ReturnType<typeof SixHiService.resolveMachinePlanContext> {
    return SixHiService.resolveMachinePlanContext(...args);
  }

  static resolveQueueContext(
    ...args: Parameters<typeof SixHiService.resolveQueueContext>
  ): ReturnType<typeof SixHiService.resolveQueueContext> {
    return SixHiService.resolveQueueContext(...args);
  }

  static resolveQueueDate(
    ...args: Parameters<typeof SixHiService.resolveQueueDate>
  ): ReturnType<typeof SixHiService.resolveQueueDate> {
    return SixHiService.resolveQueueDate(...args);
  }

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
