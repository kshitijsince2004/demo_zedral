import { DprSourceAdapter } from '../DprSourceAdapter';

export class ProductionAdapter implements DprSourceAdapter {
  name = 'ProductionAdapter';
  async resolveForDay(dayNumber: number, config: any): Promise<number | null> {
    return 100;
  }
}

export class StoppageAdapter implements DprSourceAdapter {
  name = 'StoppageAdapter';
  async resolveForDay(dayNumber: number, config: any): Promise<number | null> {
    return 15;
  }
}

export class DispositionAdapter implements DprSourceAdapter {
  name = 'DispositionAdapter';
  async resolveForDay(dayNumber: number, config: any): Promise<number | null> {
    return 5;
  }
}

export class TargetAdapter implements DprSourceAdapter {
  name = 'TargetAdapter';
  async resolveForDay(dayNumber: number, config: any): Promise<number | null> {
    return 200;
  }
}
