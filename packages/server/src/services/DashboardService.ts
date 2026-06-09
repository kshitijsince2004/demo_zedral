import { db } from '../db';

export class DashboardService {
  private db: any;

  constructor(db: any) {
    // In production, this might be a distinct Read Replica connection.
    // For local dev, we share the SQLite connection.
    this.db = db;
  }

  getSupervisorDashboard(lineId: string) {
    // Mocked OEE and stats for Supervisor
    return {
      lineId,
      status: 'RUNNING',
      oee: 84.5,
      availability: 92.0,
      performance: 95.0,
      quality: 96.6,
      pendingReviews: 3,
      downtimePareto: [
        { reason: 'Roll Change', minutes: 45 },
        { reason: 'Web Break', minutes: 20 },
        { reason: 'Preventative Maintenance', minutes: 15 }
      ],
      recentProduction: 1450 // MT
    };
  }

  getManagementDashboard() {
    // Mocked executive summary
    return {
      overallThroughput: 45000, // MT
      throughputTrend: 4.2, // % up
      overallOee: 81.2,
      oeeTrend: 1.5, // % up
      rejectionCost: 125000, // USD
      rejectionTrend: -5.4, // % down (good)
      onTimeDelivery: 96.5 // %
    };
  }
}
