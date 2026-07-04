import { SixHiService } from '../SixHiService';

export class SixHiConfigService {
  static transferMachines(
    ...args: Parameters<typeof SixHiService.transferMachines>
  ): ReturnType<typeof SixHiService.transferMachines> {
    return SixHiService.transferMachines(...args);
  }

  static ensureOrder(
    ...args: Parameters<typeof SixHiService.ensureOrder>
  ): ReturnType<typeof SixHiService.ensureOrder> {
    return SixHiService.ensureOrder(...args);
  }

  static getStoppageCategories(
    ...args: Parameters<typeof SixHiService.getStoppageCategories>
  ): ReturnType<typeof SixHiService.getStoppageCategories> {
    return SixHiService.getStoppageCategories(...args);
  }

  static saveStoppageCategory(
    ...args: Parameters<typeof SixHiService.saveStoppageCategory>
  ): ReturnType<typeof SixHiService.saveStoppageCategory> {
    return SixHiService.saveStoppageCategory(...args);
  }

  static toggleStoppageCategory(
    ...args: Parameters<typeof SixHiService.toggleStoppageCategory>
  ): ReturnType<typeof SixHiService.toggleStoppageCategory> {
    return SixHiService.toggleStoppageCategory(...args);
  }

  static saveStoppageCode(
    ...args: Parameters<typeof SixHiService.saveStoppageCode>
  ): ReturnType<typeof SixHiService.saveStoppageCode> {
    return SixHiService.saveStoppageCode(...args);
  }

  static toggleStoppageCode(
    ...args: Parameters<typeof SixHiService.toggleStoppageCode>
  ): ReturnType<typeof SixHiService.toggleStoppageCode> {
    return SixHiService.toggleStoppageCode(...args);
  }

  static getDefectCodes(
    ...args: Parameters<typeof SixHiService.getDefectCodes>
  ): ReturnType<typeof SixHiService.getDefectCodes> {
    return SixHiService.getDefectCodes(...args);
  }

  static saveDefectCode(
    ...args: Parameters<typeof SixHiService.saveDefectCode>
  ): ReturnType<typeof SixHiService.saveDefectCode> {
    return SixHiService.saveDefectCode(...args);
  }

  static toggleDefectCode(
    ...args: Parameters<typeof SixHiService.toggleDefectCode>
  ): ReturnType<typeof SixHiService.toggleDefectCode> {
    return SixHiService.toggleDefectCode(...args);
  }
}
