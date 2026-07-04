import { SixHiService } from '../SixHiService';

export class SixHiStoppageService {
  static addStoppage(
    ...args: Parameters<typeof SixHiService.addStoppage>
  ): ReturnType<typeof SixHiService.addStoppage> {
    return SixHiService.addStoppage(...args);
  }

  static updateStoppage(
    ...args: Parameters<typeof SixHiService.updateStoppage>
  ): ReturnType<typeof SixHiService.updateStoppage> {
    return SixHiService.updateStoppage(...args);
  }

  static endStoppage(
    ...args: Parameters<typeof SixHiService.endStoppage>
  ): ReturnType<typeof SixHiService.endStoppage> {
    return SixHiService.endStoppage(...args);
  }

  static getShiftStoppages(
    ...args: Parameters<typeof SixHiService.getShiftStoppages>
  ): ReturnType<typeof SixHiService.getShiftStoppages> {
    return SixHiService.getShiftStoppages(...args);
  }
}
