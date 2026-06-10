/**
 * DPR template field catalog — maps every input cell in the Excel template
 * to its platform data source and mapping status.
 */

export type MappingStatus = 'mapped' | 'calculated' | 'manual' | 'missing';
export type MappingConfidence = 'high' | 'medium' | 'low';

export interface DprFieldDefinition {
  fieldId: string;
  templateRegion: string;
  templateCols: string;
  dataSource: string;
  status: MappingStatus;
  confidence: MappingConfidence;
  notes?: string;
}

export const DPR_FIELD_CATALOG: DprFieldDefinition[] = [
  { fieldId: 'prod_shift_a', templateRegion: 'main', templateCols: 'C', dataSource: 'txn.shift_log + process tables → DprAggregator.prod.A', status: 'mapped', confidence: 'high' },
  { fieldId: 'prod_shift_b', templateRegion: 'main', templateCols: 'D', dataSource: 'txn.shift_log + process tables → DprAggregator.prod.B', status: 'mapped', confidence: 'high' },
  { fieldId: 'prod_shift_c', templateRegion: 'main', templateCols: 'E', dataSource: 'txn.shift_log + process tables → DprAggregator.prod.C', status: 'mapped', confidence: 'high' },
  { fieldId: 'prod_total', templateRegion: 'main', templateCols: 'F', dataSource: 'Excel formula =C+D+E', status: 'calculated', confidence: 'high' },
  { fieldId: 'prod_cum', templateRegion: 'main', templateCols: 'G', dataSource: 'Excel formula chains previous day', status: 'calculated', confidence: 'high' },
  { fieldId: 'prod_avg', templateRegion: 'main', templateCols: 'H', dataSource: 'Excel formula =G/BH', status: 'calculated', confidence: 'high' },
  { fieldId: 'monthly_target', templateRegion: 'main', templateCols: 'B', dataSource: 'planning.monthly_target → ExportReadRepository.fetchTargets', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_elect_a', templateRegion: 'main', templateCols: 'Z', dataSource: 'txn.stoppage_event (category=ELECTRICAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_elect_b', templateRegion: 'main', templateCols: 'AA', dataSource: 'txn.stoppage_event (category=ELECTRICAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_elect_c', templateRegion: 'main', templateCols: 'AB', dataSource: 'txn.stoppage_event (category=ELECTRICAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_mech_a', templateRegion: 'main', templateCols: 'AD', dataSource: 'txn.stoppage_event (category=MECHANICAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_mech_b', templateRegion: 'main', templateCols: 'AE', dataSource: 'txn.stoppage_event (category=MECHANICAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_mech_c', templateRegion: 'main', templateCols: 'AF', dataSource: 'txn.stoppage_event (category=MECHANICAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_oper_a', templateRegion: 'main', templateCols: 'AH', dataSource: 'txn.stoppage_event (category=OPERATIONAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_oper_b', templateRegion: 'main', templateCols: 'AI', dataSource: 'txn.stoppage_event (category=OPERATIONAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'stoppage_oper_c', templateRegion: 'main', templateCols: 'AJ', dataSource: 'txn.stoppage_event (category=OPERATIONAL) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'equip_avail_a', templateRegion: 'main', templateCols: 'AL', dataSource: 'txn.stoppage_event (category=EQUIPMENT_AVAILABILITY) → DprAggregator', status: 'mapped', confidence: 'medium' },
  { fieldId: 'equip_avail_b', templateRegion: 'main', templateCols: 'AM', dataSource: 'txn.stoppage_event (category=EQUIPMENT_AVAILABILITY) → DprAggregator', status: 'mapped', confidence: 'medium' },
  { fieldId: 'equip_avail_c', templateRegion: 'main', templateCols: 'AN', dataSource: 'txn.stoppage_event (category=EQUIPMENT_AVAILABILITY) → DprAggregator', status: 'mapped', confidence: 'medium' },
  { fieldId: 'prev_maint', templateRegion: 'main', templateCols: 'AP', dataSource: 'txn.stoppage_event (category=PREV_MAINT) → DprAggregator', status: 'mapped', confidence: 'medium' },
  { fieldId: 'power_fail_a', templateRegion: 'main', templateCols: 'AR', dataSource: 'txn.stoppage_event (category=POWER_FAILURE) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'power_fail_b', templateRegion: 'main', templateCols: 'AS', dataSource: 'txn.stoppage_event (category=POWER_FAILURE) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'power_fail_c', templateRegion: 'main', templateCols: 'AT', dataSource: 'txn.stoppage_event (category=POWER_FAILURE) → DprAggregator', status: 'mapped', confidence: 'high' },
  { fieldId: 'rm_shortage_a', templateRegion: 'main', templateCols: 'BB', dataSource: 'txn.stoppage_event (category=RM_SHORTAGE) → DprAggregator', status: 'mapped', confidence: 'medium' },
  { fieldId: 'rm_shortage_b', templateRegion: 'main', templateCols: 'BC', dataSource: 'txn.stoppage_event (category=RM_SHORTAGE) → DprAggregator', status: 'mapped', confidence: 'medium' },
  { fieldId: 'rm_shortage_c', templateRegion: 'main', templateCols: 'BD', dataSource: 'txn.stoppage_event (category=RM_SHORTAGE) → DprAggregator', status: 'mapped', confidence: 'medium' },
  { fieldId: 'scrap_shift_a', templateRegion: 'main', templateCols: 'BJ', dataSource: 'txn.disposition_log (type=SCRAP) → DprAggregator.scrap.A', status: 'mapped', confidence: 'high' },
  { fieldId: 'scrap_shift_b', templateRegion: 'main', templateCols: 'BN', dataSource: 'txn.disposition_log (type=SCRAP) → DprAggregator.scrap.B', status: 'mapped', confidence: 'high' },
  { fieldId: 'scrap_shift_c', templateRegion: 'main', templateCols: 'BR', dataSource: 'txn.disposition_log (type=SCRAP) → DprAggregator.scrap.C', status: 'mapped', confidence: 'high' },
  { fieldId: 'internal_rej_a', templateRegion: 'main', templateCols: 'BK', dataSource: 'txn.disposition_log (type=REJ) → DprAggregator.internalRej.A', status: 'mapped', confidence: 'high' },
  { fieldId: 'internal_rej_b', templateRegion: 'main', templateCols: 'BO', dataSource: 'txn.disposition_log (type=REJ) → DprAggregator.internalRej.B', status: 'mapped', confidence: 'high' },
  { fieldId: 'internal_rej_c', templateRegion: 'main', templateCols: 'BS', dataSource: 'txn.disposition_log (type=REJ) → DprAggregator.internalRej.C', status: 'mapped', confidence: 'high' },
  { fieldId: 'utilisation_tdy', templateRegion: 'main', templateCols: 'O', dataSource: 'Excel formula from stoppage + availability', status: 'calculated', confidence: 'high' },
  { fieldId: 'utilisation_cum', templateRegion: 'main', templateCols: 'P', dataSource: 'Excel formula cumulative chain', status: 'calculated', confidence: 'high' },
  { fieldId: 'prod_rate', templateRegion: 'main', templateCols: 'Q-V', dataSource: 'Excel formula from production / availability', status: 'calculated', confidence: 'high' },
  { fieldId: 'despatch_mt', templateRegion: 'summary', templateCols: 'F (WIP row)', dataSource: 'DprAggregator rollups.despatchMt', status: 'mapped', confidence: 'medium' },
  { fieldId: 'overtime', templateRegion: 'summary', templateCols: 'B-E (O.T row)', dataSource: 'Not auto-sourced — defaults to 0', status: 'manual', confidence: 'low', notes: 'No txn source; exports as 0' },
  { fieldId: 'wr_change_4hi', templateRegion: 'summary', templateCols: 'K-P (SCR% row)', dataSource: 'DprAggregator rollups.wrChange.4hi', status: 'mapped', confidence: 'medium' },
  { fieldId: 'wr_change_6hi', templateRegion: 'summary', templateCols: 'K-P (TGT% row)', dataSource: 'DprAggregator rollups.wrChange.6hi', status: 'mapped', confidence: 'medium' },
  { fieldId: 'wr_change_2hi', templateRegion: 'summary', templateCols: 'K-P (SCR% TDY row)', dataSource: 'DprAggregator rollups.wrChange.2hi', status: 'mapped', confidence: 'medium' },
  { fieldId: 'delay_time', templateRegion: 'DELAY', templateCols: 'D', dataSource: 'txn.stoppage_event → buildDelayLog', status: 'mapped', confidence: 'high' },
  { fieldId: 'delay_agency', templateRegion: 'DELAY', templateCols: 'E', dataSource: 'txn.stoppage_event.agency → buildDelayLog', status: 'mapped', confidence: 'high' },
  { fieldId: 'delay_reason', templateRegion: 'DELAY', templateCols: 'F', dataSource: 'txn.stoppage_event.reason → buildDelayLog', status: 'mapped', confidence: 'high' },
  { fieldId: 'day_date', templateRegion: 'title', templateCols: 'M', dataSource: 'Generated from scope.month + dayIndex', status: 'mapped', confidence: 'high' },
  { fieldId: 'day_number', templateRegion: 'title', templateCols: 'BH', dataSource: 'dayIndex (1..daysInMonth)', status: 'mapped', confidence: 'high' },
];

export function catalogSummary() {
  const byStatus = { mapped: 0, calculated: 0, manual: 0, missing: 0 };
  for (const f of DPR_FIELD_CATALOG) byStatus[f.status]++;
  return { total: DPR_FIELD_CATALOG.length, byStatus };
}
