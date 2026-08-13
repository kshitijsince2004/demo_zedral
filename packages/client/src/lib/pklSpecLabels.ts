export type PklSpecLimit = {
  param_key: string;
  tank_scope: string;
  min_val: number | string | null;
  max_val: number | string | null;
  unit: string | null;
};

export const PKL_SPEC_PARAM_LABELS: Record<string, string> = {
  tank_temp: 'Tank Temp °C',
  tank_level: 'Tank Level mm',
  acid_strength: 'Acid Strength %',
  iron_strength: 'Iron Strength %',
  steam_inlet: 'Steam Inlet below PRV',
  steam_outlet: 'Steam Outlet of PRV',
  steam_outlet_burner: 'Steam Outlet of Burner',
  burner_pressure: 'Burner Masha',
  hot_air_temp: 'Hot Air Temp °C',
  rinse_flow: 'Rinse Flow',
  rinse_temp: 'Rinse Temp °C',
  rinse_ph: 'Rinse pH',
  rinse_cl: 'Rinse Cl',
};

export const PKL_SPEC_SCOPES = ['T1', 'T2', 'T3', 'RINSE', 'LINE'] as const;

export type PklSpecForm = {
  paramKey: string;
  tankScope: string;
  minVal: string;
  maxVal: string;
  unit: string;
};

export const emptyPklSpecForm = (): PklSpecForm => ({
  paramKey: 'tank_temp',
  tankScope: 'T1',
  minVal: '',
  maxVal: '',
  unit: 'C',
});
