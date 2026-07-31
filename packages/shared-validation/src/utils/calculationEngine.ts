/**
 * Calculates the scrap percentage based on scrap weight and total weight.
 * @param scrapMt Scrap weight in metric tons.
 * @param totalMt Total weight in metric tons.
 * @returns Scrap percentage, rounded to 2 decimal places. Returns 0 if totalMt is 0.
 */
export const calculateScrapPct = (scrapMt: number, totalMt: number): number => {
  if (totalMt <= 0) return 0;
  const pct = (scrapMt / totalMt) * 100;
  return Math.round(pct * 100) / 100;
};

/**
 * Calculates the duration of a stoppage in minutes.
 * @param timeFrom Start time of the stoppage.
 * @param timeTo End time of the stoppage.
 * @returns Duration in minutes. Returns 0 if timeTo is before timeFrom.
 */
export const calculateStoppageDuration = (timeFrom: Date, timeTo: Date): number => {
  const diffMs = timeTo.getTime() - timeFrom.getTime();
  if (diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60));
};

/**
 * Calculates the total charge weight from an array of individual coil weights.
 * @param coilWeights Array of weights in MT.
 * @returns Total charge weight in MT.
 */
export const calculateChargeWeight = (coilWeights: number[]): number => {
  return coilWeights.reduce((sum, weight) => sum + weight, 0);
};

/** CRS mass balance: Σ line output + scrap + rejection ≈ input. Warn beyond relTol (default 2%). */
export const crsMassBalanceWarn = (
  inputWtMt: number,
  lineOutputs: number[],
  scrapMt = 0,
  rejectionMt = 0,
  relTol = 0.02,
): boolean => {
  if (inputWtMt <= 0) return false;
  const sum = lineOutputs.reduce((a, b) => a + b, 0) + scrapMt + rejectionMt;
  return Math.abs(sum - inputWtMt) > inputWtMt * relTol;
};

/**
 * Calculates the total production from an array of process entries.
 * Assuming each entry has a `weightMt` property.
 * @param entries Array of process entries.
 * @returns Total production weight in MT.
 */
export const calculateTotalProduction = (entries: { weightMt?: number }[]): number => {
  return entries.reduce((sum, entry) => sum + (entry.weightMt || 0), 0);
};

/**
 * Converts Kilograms to Metric Tons.
 * @param kg Weight in Kilograms.
 * @returns Weight in MT.
 */
export const convertKgToMt = (kg: number): number => {
  return kg / 1000;
};

/**
 * Converts a non-negative kilogram weight to metric tons for the CTL field set.
 * @param kg Non-negative weight in kilograms.
 * @returns Weight in MT (kg / 1000).
 * @throws {Error} If kg is negative.
 */
export const kgToMt = (kg: number): number => {
  if (kg < 0) {
    throw new Error('Kilogram weight must be non-negative');
  }
  return kg / 1000;
};
