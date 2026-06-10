export interface DprSourceAdapter {
  name: string;
  resolveForDay(dayNumber: number, config: any): Promise<number | null>;
}
