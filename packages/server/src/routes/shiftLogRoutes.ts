import { Router } from 'express';
import { ShiftLogService } from '../services/shiftLogService';
import { requireAuth, requireLineAccess, requireRole } from '../middleware/authMiddleware';
import { validateBadgePin } from '../services/authService';
import { assertShiftLogAccess } from '../services/shiftLogAccessService';
import { assertShiftLogApproval } from '../auth/machineAccessPolicy';
import { getScopedLineCodes } from '../auth/lineAccessPolicy';
import { UserRole } from '@m1/shared-validation';
import { db } from '../db';
import {
  ShiftLogValidationGateError,
  ShiftLogValidationService,
} from '../services/shiftLogValidationService';
import { OverrideRequest } from '../services/overrideService';
import { SixHiExecutionService, SixHiShiftService } from '../services/sixHi';
import { formatPlantDate } from '@m1/shared-validation';
import { ReportingService } from '../services/ReportingService';

function validationErrorResponse(error: unknown) {
  if (error instanceof ShiftLogValidationGateError) {
    return {
      status: 400,
      body: {
        error: 'Shift log validation failed',
        validationResult: error.validationResult,
      },
    };
  }
  const message = error instanceof Error ? error.message : 'Request failed';
  const status =
    message.includes('Forbidden') || message.includes('read-only') ? 403 : 400;
  return { status, body: { error: message } };
}

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.post('/', requireLineAccess('WRITE'), async (req, res) => {
  try {
    const id = await ShiftLogService.create({
      ...req.body,
      supervisorId: req.user!.id,
    });
    res.status(201).json({ id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const state = req.query.state as string;
    const requestedLines = req.query.line
      ? (Array.isArray(req.query.line) ? req.query.line : [req.query.line])
      : [];

    const scopedLines = getScopedLineCodes(req.user!, 'READ');
    let effectiveLines = requestedLines.map((l) => String(l).toUpperCase());

    if (scopedLines !== null) {
      if (effectiveLines.length > 0) {
        effectiveLines = effectiveLines.filter((l) => scopedLines.includes(l));
      } else {
        effectiveLines = scopedLines;
      }
      if (effectiveLines.length === 0) {
        return res.json([]);
      }
    }

    let query = db.selectFrom('txn.shift_log as sl')
      .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
      .leftJoin('security.app_user as u', 'sl.shift_manager_id', 'u.user_id')
      .select([
        'sl.shift_log_id as id',
        'sl.prod_date as shiftDate',
        'sl.shift_code as shiftCode',
        'p.code as processLine',
        'u.full_name as submittedBy',
        'sl.submitted_at as submittedAt',
        'sl.state as state',
        'sl.state as state',
        'sl.process_id as processId',
        'sl.mill_type as millType'
      ]);

    if (state) {
      query = query.where('sl.state', '=', state);
    }

    if (effectiveLines.length > 0) {
      query = query.where('p.code', 'in', effectiveLines);
    }

    const logs = await query.orderBy('sl.submitted_at', 'desc').execute();

    const result = await Promise.all(logs.map(async (log) => {
      const overrides = await db.selectFrom('txn.validation_overrides')
        .select(db.fn.count<number>('override_id').as('count'))
        .where('shift_log_id', '=', log.id)
        .executeTakeFirst();

      const processTable = ShiftLogService.getProcessTable(log.processId);
      let entryCount = 0;
      if (processTable === 'txn.crm6_order') {
        const countRes = await db.selectFrom('txn.crm6_order')
          .select(db.fn.count('order_id').as('count'))
          .where('shift_log_id', '=', log.id)
          .where('status', '!=', 'CANCELLED')
          .executeTakeFirst();
        entryCount = Number(countRes?.count || 0);
      } else if (processTable) {
        const countRes = await db.selectFrom(processTable as any)
          .select(db.fn.count('entry_id').as('count'))
          .where('shift_log_id', '=', log.id)
          .executeTakeFirst();
        entryCount = Number(countRes?.count || 0);
      }

      const { resolveShiftLogMachines } = await import('../auth/machineAccessPolicy');
      const machines = await resolveShiftLogMachines({
         shift_log_id: log.id,
         process_id: log.processId,
         mill_type: log.millType,
      } as any);

      return {
        id: String(log.id),
        shiftDate: log.shiftDate,
        shiftCode: log.shiftCode,
        processLine: log.processLine,
        submittedBy: log.submittedBy || 'Unknown',
        submittedAt: log.submittedAt,
        state: log.state,
        entryCount,
        overrideCount: Number(overrides?.count || 0),
        machines
      };
    }));

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/active/:processCode', requireLineAccess('READ'), async (req, res) => {
  try {
    const processCode = req.params.processCode;
    const process = await db.selectFrom('master.process').select('process_id').where('code', '=', processCode).executeTakeFirst();
    if (!process) return res.status(404).json({ error: 'Process not found' });

    const requestedDate = typeof req.query.date === 'string' ? req.query.date.slice(0, 10) : undefined;
    const requestedShift = typeof req.query.shift === 'string' ? req.query.shift.toUpperCase() : undefined;

    let activeLog;

    if (requestedDate && requestedShift) {
      const planDate = SixHiShiftService.toPlanDate(requestedDate);
      activeLog = await db.selectFrom('txn.shift_log')
        .selectAll()
        .where('process_id', '=', process.process_id)
        .where('state', '=', 'DRAFT')
        .where('prod_date', '=', planDate)
        .where('shift_code', '=', requestedShift)
        .executeTakeFirst();

      // Submitted shifts are no longer DRAFT but operators still need that shift log
      // (e.g. completed-order history). Do not fall back to an unrelated DRAFT shift.
      if (!activeLog) {
        activeLog = await db.selectFrom('txn.shift_log')
          .selectAll()
          .where('process_id', '=', process.process_id)
          .where('prod_date', '=', planDate)
          .where('shift_code', '=', requestedShift)
          .orderBy('shift_log_id', 'desc')
          .executeTakeFirst();
      }

      if (!activeLog && processCode === '6HI' && req.user) {
        const shiftLogId = await SixHiShiftService.ensureActiveShiftLog(
          req.user.id,
          planDate,
          requestedShift,
        );
        activeLog = await db.selectFrom('txn.shift_log')
          .selectAll()
          .where('shift_log_id', '=', shiftLogId)
          .executeTakeFirst();
      }
    }

    if (!activeLog) {
      activeLog = await db.selectFrom('txn.shift_log')
        .selectAll()
        .where('process_id', '=', process.process_id)
        .where('state', '=', 'DRAFT')
        .orderBy('prod_date', 'desc')
        .executeTakeFirst();
    }

    if (!activeLog) return res.status(404).json({ error: 'No active shift found' });

    const stoppagesRaw = await db.selectFrom('txn.stoppage as se')
      .innerJoin('master.stoppage_code as sc', 'se.breakdown_code', 'sc.stoppage_code')
      .select([
        'se.stoppage_id as id',
        'sc.stoppage_code as code',
        'sc.description as reason',
        'se.start_at',
        'se.end_at',
        'se.duration_min as durationMins',
        'se.remarks'
      ])
      .where('se.shift_log_id', '=', activeLog.shift_log_id)
      .execute();

    let totalProducedMt = 0;
    if (processCode === '6HI') {
      totalProducedMt = await SixHiExecutionService.getProducedMt(String(activeLog.shift_log_id));
    } else {
      const prodEntries = await db.selectFrom('txn.prod_hrs')
        .select('entry_id')
        .where('shift_log_id', '=', activeLog.shift_log_id)
        .execute();

      if (prodEntries.length > 0) {
        const entryIds = prodEntries.map(e => e.entry_id);
        const slits = await db.selectFrom('txn.prod_hrs_slit')
          .innerJoin('coil.coil', 'txn.prod_hrs_slit.child_coil_no', 'coil.coil.coil_no')
          .select('coil.coil.weight_mt as weight_mt')
          .where('entry_id', 'in', entryIds)
          .execute();
        totalProducedMt = slits.reduce((sum, s) => sum + Number(s.weight_mt || 0), 0);
      }
    }

    res.json({
      shiftLogId: String(activeLog.shift_log_id),
      shiftDate: formatPlantDate(activeLog.prod_date),
      shiftCode: activeLog.shift_code,
      targetMt: Number(activeLog.target_mt || 0),
      producedMt: totalProducedMt,
      stoppages: stoppagesRaw.map(s => ({
        id: String(s.id),
        code: s.code,
        reason: s.reason,
        fromTime: s.start_at ? new Date(s.start_at).toISOString().substring(11, 16) : '',
        toTime: s.end_at ? new Date(s.end_at).toISOString().substring(11, 16) : null,
        durationMins: s.durationMins,
        remarks: s.remarks || ''
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/handover/summary', async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'READ');
    const summary = await ReportingService.getMachineHandoverSummary(req.params.id);
    res.json(summary);
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 404;
    res.status(status).json({ error: error.message });
  }
});

router.get('/:id/validation', async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'READ');
    const validationResult = await ShiftLogValidationService.validate(req.params.id);
    res.json({ validationResult });
  } catch (error: any) {
    const { status, body } = validationErrorResponse(error);
    res.status(status).json(body);
  }
});

router.get('/:id/state', async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'READ');
    const log = await ShiftLogService.getById(req.params.id);
    if (!log) {
      return res.status(404).json({ error: 'Shift log not found' });
    }
    res.json({ state: log.state });
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') || error.message?.includes('read-only') ? 403 : 500;
    res.status(status).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'READ');
    const log = await ShiftLogService.getById(req.params.id);
    if (!log) {
      return res.status(404).json({ error: 'Shift log not found' });
    }

    const overrides = await ShiftLogService.getOverrides(req.params.id);

    res.json({
      ...log,
      overrides
    });
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') || error.message?.includes('read-only') ? 403 : 500;
    res.status(status).json({ error: error.message });
  }
});

router.put('/:id/submit', async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'WRITE');
    const overrides = (req.body?.overrides ?? []) as OverrideRequest[];
    await ShiftLogService.submit(req.params.id, { overrides, user: req.user! });
    res.json({ success: true });
  } catch (error: any) {
    const { status, body } = validationErrorResponse(error);
    res.status(status).json(body);
  }
});

router.put('/:id/approve', requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD]), async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'APPROVE');
    await assertShiftLogApproval(req.user!, req.params.id);
    await ShiftLogService.approve(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (error: any) {
    const { status, body } = validationErrorResponse(error);
    res.status(status).json(body);
  }
});

router.put('/:id/reject', requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD]), async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'APPROVE');
    await assertShiftLogApproval(req.user!, req.params.id);
    await ShiftLogService.reject(req.params.id, req.user!.id, req.body.note);
    res.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 400;
    res.status(status).json({ error: error.message });
  }
});

router.put('/:id/reopen', requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD]), async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'APPROVE');
    await assertShiftLogApproval(req.user!, req.params.id);
    await ShiftLogService.reopen(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 400;
    res.status(status).json({ error: error.message });
  }
});

export default router;
