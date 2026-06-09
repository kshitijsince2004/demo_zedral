export const PLANT_HEAD_WINDOWS = [1, 7, 30, 90] as const;
export type PlantHeadWindow = (typeof PLANT_HEAD_WINDOWS)[number];

export const DEFAULT_PLANT_HEAD_WINDOW: PlantHeadWindow = 7;

export function parsePlantHeadWindow(raw: unknown): PlantHeadWindow | null {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_PLANT_HEAD_WINDOW;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  if (!(PLANT_HEAD_WINDOWS as readonly number[]).includes(n)) {
    return null;
  }
  return n as PlantHeadWindow;
}
