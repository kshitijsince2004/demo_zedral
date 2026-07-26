import { Router } from 'express';
import { ShiftLogService } from '../services/shiftLogService';
import {
  DailyReportService,
  DashboardReportingService,
  TraceabilityReportingService,
} from '../services/reporting';
import { ReportingService } from '../services/ReportingService';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { getScopedLineCodes } from '../auth/lineAccessPolicy';
import { UserRole } from '@m1/shared-validation';
import { parsePlantHeadWindow } from '../reporting/plantHeadWindow';
import {
  parseDrilldownPage,
  parsePlantHeadDrilldownMetric,
} from '../reporting/plantHeadDrilldown';
import { currentPlantDate } from '../utils/dateOnly';
import { MachineRegistryService } from '../services/MachineRegistryService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.get('/machine-head', requireRole([UserRole.MACHINE_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const raw = req.user!.machineAccess ?? [];
    const isAdmin = req.user!.roles.includes(UserRole.ADMIN as string);
    // Admin with empty access = all operational; MH = assigned ∩ operational.
    const machines = await MachineRegistryService.getOperationalMachineCodes(
      raw.length === 0 && isAdmin ? null : raw,
    );
    if (machines.length === 0 && !isAdmin) {
       return res.json({ lineStatuses: [], pendingReviewCount: 0, lineOee: [], downtimePareto: [], yieldPct: 0, rejectionRatePct: 0 });
    }
    const data = await DashboardReportingService.getMachineHeadDashboard(machines);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get(
  '/plant-head/drilldown',
  requireRole([UserRole.PLANT_HEAD, UserRole.ADMIN]),
  async (req, res) => {
    try {
      const metricResult = parsePlantHeadDrilldownMetric(req.query.metric);
      if (!metricResult.ok) {
        if (metricResult.error === 'MISSING_METRIC') {
          return res.status(400).json({
            error: 'MISSING_METRIC',
            message: 'A metric identifier is required.',
          });
        }
        return res.status(400).json({
          error: 'INVALID_METRIC',
          message: `Unrecognized metric '${metricResult.value}'.`,
        });
      }

      const windowDays = parsePlantHeadWindow(req.query.window);
      if (windowDays === null) {
        return res.status(400).json({
          error: 'INVALID_WINDOW',
          message: 'window must be one of 1, 7, 30, or 90 days.',
        });
      }

      const page = parseDrilldownPage(req.query.page);
      const data = await DashboardReportingService.getPlantHeadDrilldown(
        metricResult.metric,
        windowDays,
        page,
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

router.get('/plant-head/backlog', requireRole([UserRole.PLANT_HEAD, UserRole.MACHINE_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const machineCode = req.query.machineCode != null ? String(req.query.machineCode) : undefined;
    const search = req.query.search != null ? String(req.query.search) : undefined;
    const data = await DashboardReportingService.getPlantHeadBacklog({ machineCode, search });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/plant-head', requireRole([UserRole.PLANT_HEAD, UserRole.MACHINE_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const windowDays = parsePlantHeadWindow(req.query.window);
    if (windowDays === null) {
      return res.status(400).json({
        error: 'INVALID_WINDOW',
        message: 'window must be one of 1, 7, 30, or 90 days.',
      });
    }

    const filters = {
      lines: req.query.lines ? String(req.query.lines).split(',').filter(Boolean) : undefined,
      shifts: req.query.shifts ? String(req.query.shifts).split(',').filter(Boolean) : undefined,
      grades: req.query.grades ? String(req.query.grades).split(',').filter(Boolean) : undefined,
      customers: req.query.customers ? String(req.query.customers).split(',').filter(Boolean) : undefined,
      coils: req.query.coils ? String(req.query.coils).split(',').filter(Boolean) : undefined,
    };

    const data = await DashboardReportingService.getPlantHeadDashboard(windowDays, filters);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/management', requireRole([UserRole.PLANT_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const period = (req.query.period as string) || 'shift';
    const allowed = ['shift', 'day', 'week', 'month'];
    const normalized = allowed.includes(period) ? period : 'shift';
    const data = await DashboardReportingService.getManagementDashboard(normalized as any);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/drilldown', requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const metric = req.query.metric as string;
    const scope = {
      processId: req.query.processId as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      shiftCode: req.query.shiftCode as string | undefined,
      coilNo: req.query.coilNo as string | undefined,
    };
    const data = await DashboardReportingService.getDrilldown(metric, scope);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/daily', requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const date = (req.query.date as string) || currentPlantDate();
    const data = await DailyReportService.getDailyReport(date);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/coil-traceability', requireRole([UserRole.PLANT_HEAD, UserRole.MACHINE_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const rawCoilNo = req.query.coilNo as string;
    if (!rawCoilNo) {
      return res.status(400).json({ error: 'INVALID_COIL_NUMBER', message: 'coilNo query parameter is required' });
    }
    const coilNo = rawCoilNo.trim();
    if (!coilNo || coilNo.length > 64) {
      return res.status(400).json({ error: 'INVALID_COIL_NUMBER', message: 'coilNo must be between 1 and 64 characters' });
    }
    const results = await TraceabilityReportingService.searchCoilTraceability(coilNo);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/handover', requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const summary = await ReportingService.getMachineHandoverSummary(req.query.shiftLogId as string);
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
