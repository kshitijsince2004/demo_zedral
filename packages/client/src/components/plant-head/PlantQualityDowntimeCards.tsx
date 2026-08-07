import { PlantDowntimeCard, PlantQualityCard } from './PlantQualityDowntimeArea';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';

/** Combined export so PlantHeadDashboard can lazy-load both cards in one chunk (PERF-A3). */
export function PlantQualityDowntimeCards({ data }: { data: ExtendedPlantHeadDashboardData }) {
  return (
    <>
      <PlantDowntimeCard data={data} />
      <PlantQualityCard data={data} />
    </>
  );
}
