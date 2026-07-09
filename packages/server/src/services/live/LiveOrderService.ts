import { LiveService } from '../LiveService';

export class LiveOrderService {
  static getActiveOrders(
    ...args: Parameters<typeof LiveService.getActiveOrders>
  ): ReturnType<typeof LiveService.getActiveOrders> {
    return LiveService.getActiveOrders(...args);
  }

  static getOrderDetail(
    ...args: Parameters<typeof LiveService.getOrderDetail>
  ): ReturnType<typeof LiveService.getOrderDetail> {
    return LiveService.getOrderDetail(...args);
  }

  static getNextOrder(
    ...args: Parameters<typeof LiveService.getNextOrder>
  ): ReturnType<typeof LiveService.getNextOrder> {
    return LiveService.getNextOrder(...args);
  }

  static getShiftCompletedProductionMt(
    ...args: Parameters<typeof LiveService.getShiftCompletedProductionMt>
  ): ReturnType<typeof LiveService.getShiftCompletedProductionMt> {
    return LiveService.getShiftCompletedProductionMt(...args);
  }

  static getRejectedOrders(
    ...args: Parameters<typeof LiveService.getRejectedOrders>
  ): ReturnType<typeof LiveService.getRejectedOrders> {
    return LiveService.getRejectedOrders(...args);
  }
}
