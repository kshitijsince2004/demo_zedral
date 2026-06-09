import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Plant Head dashboard — no mocked source', () => {
  it('DashboardService does not define getPlantHeadDashboard', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/DashboardService.ts'),
      'utf8',
    );
    expect(src).not.toContain('getPlantHeadDashboard');
    expect(src).not.toContain('plantWideOee: 81.2');
  });

  it('reportRoutes uses ReportingService for plant-head', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/routes/reportRoutes.ts'),
      'utf8',
    );
    expect(src).toContain('ReportingService.getPlantHeadDashboard');
    expect(src).toContain('/plant-head/drilldown');
    expect(src).toContain('ReportingService.getPlantHeadDrilldown');
  });
});
