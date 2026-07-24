import { Router } from 'express';
import { sql } from 'kysely';
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
import { formatPlantDate, formatPlantTime, postgresDateOnly } from '@m1/shared-validation';
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
    const shiftDate = req.query.shiftDate as string | undefined;
    const shiftCode = req.query.shiftCode as string | undefined;
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

    // Calendar DATE as text — do not run through timestamptz/Asia/Kolkata (off-by-one on DATE cols).
    const plantDaySql = sql<string>`(sl.prod_date::date)::text`;

    let query = db.selectFrom('txn.shift_log as sl')
      .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
      .leftJoin('security.app_user as u', 'sl.shift_manager_id', 'u.user_id')
      .select([
        'sl.shift_log_id as id',
        plantDaySql.as('shiftDate'),
        'sl.shift_code as shiftCode',
        'p.code as processLine',
        'u.full_name as submittedBy',
        'sl.submitted_at as submittedAt',
        'sl.state as state',
        'sl.process_id as processId',
        'sl.mill_type as millType',
      ]);

    if (state) {
      query = query.where('sl.state', '=', state);
    }

    if (shiftDate) {
      const day = postgresDateOnly(shiftDate);
      // Match either corrected session plant day or shift_log.prod_date (pre-migration rows).
      query = query.where((eb) =>
        eb.or([
          eb(sql`(sl.prod_date::date)`, '=', sql`${day}::date`),
          eb.exists(
            eb
              .selectFrom('txn.machine_shift_session as mss')
              .select(sql`1`.as('one'))
              .whereRef('mss.shift_log_id', '=', 'sl.shift_log_id')
              .where(sql`(mss.prod_date::date)`, '=', sql`${day}::date`),
          ),
        ]),
      );
    }

    if (shiftCode) {
      query = query.where('sl.shift_code', '=', String(shiftCode).toUpperCase());
    }

    if (effectiveLines.length > 0) {
      query = query.where('p.code', 'in', effectiveLines);
    }

    const logs = await query
      .orderBy('sl.prod_date', 'desc')
      .orderBy('sl.shift_code', 'asc')
      .orderBy('sl.submitted_at', 'desc')
      .execute();

    type CardRow = {
      id: string;
      shiftDate: string;
      shiftCode: string;
      processLine: string;
      submittedBy: string;
      submittedAt: Date | string | null;
      state: string;
      entryCount: number;
      overrideCount: number;
      millType: string | null;
      machine: string;
      machines: string[];
    };

    if (logs.length === 0) {
      return res.json([]);
    }

    const logIds = logs.map((l) => l.id);

    // Batch: session plant days, machines, overrides, CRM entry counts (avoids N+1).
    const [sessionRows, orderMachineRows, overrideRows, crmCountRows, masterMachineRows] = await Promise.all([
      db
        .selectFrom('txn.machine_shift_session')
        .select([
          'shift_log_id',
          'machine_code',
          sql<string>`(prod_date::date)::text`.as('plantDay'),
          'started_at',
        ])
        .where('shift_log_id', 'in', logIds as any)
        .execute(),
      db
        .selectFrom('txn.crm_order as o')
        .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
        .select(['o.shift_log_id', 'pb.machine_code'])
        .where('o.shift_log_id', 'in', logIds as any)
        .where('o.status', '!=', 'CANCELLED')
        .execute(),
      db
        .selectFrom('txn.validation_overrides')
        .select(['shift_log_id', db.fn.countAll<number>().as('count')])
        .where('shift_log_id', 'in', logIds as any)
        .groupBy('shift_log_id')
        .execute(),
      db
        .selectFrom('txn.crm_order as o')
        .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
        .select([
          'o.shift_log_id',
          'pb.machine_code',
          db.fn.countAll<number>().as('count'),
        ])
        .where('o.shift_log_id', 'in', logIds as any)
        .where('o.status', '!=', 'CANCELLED')
        .groupBy(['o.shift_log_id', 'pb.machine_code'])
        .execute(),
      db
        .selectFrom('master.machine')
        .select(['process_id', 'machine_code'])
        .where(
          'process_id',
          'in',
          (() => {
            const ids = [...new Set(logs.map((l) => l.processId).filter((id): id is number => id != null))];
            return ids.length > 0 ? ids : [-1];
          })(),
        )
        .execute(),
    ]);

    const sessionDayByLog = new Map<string, { day: string; startedAt: number }>();
    const sessionMachinesByLog = new Map<string, Set<string>>();
    for (const row of sessionRows) {
      const id = String(row.shift_log_id);
      const startedAt = row.started_at ? new Date(row.started_at).getTime() : 0;
      if (row.plantDay) {
        const prev = sessionDayByLog.get(id);
        if (!prev || startedAt >= prev.startedAt) {
          sessionDayByLog.set(id, { day: postgresDateOnly(row.plantDay), startedAt });
        }
      }
      if (row.machine_code) {
        const set = sessionMachinesByLog.get(id) ?? new Set<string>();
        set.add(String(row.machine_code).toUpperCase());
        sessionMachinesByLog.set(id, set);
      }
    }

    const orderMachinesByLog = new Map<string, Set<string>>();
    for (const row of orderMachineRows) {
      const id = String(row.shift_log_id);
      if (!row.machine_code) continue;
      const set = orderMachinesByLog.get(id) ?? new Set<string>();
      set.add(String(row.machine_code).toUpperCase());
      orderMachinesByLog.set(id, set);
    }

    const overrideByLog = new Map<string, number>();
    for (const row of overrideRows) {
      overrideByLog.set(String(row.shift_log_id), Number(row.count || 0));
    }

    const crmCountByLogMachine = new Map<string, number>();
    for (const row of crmCountRows) {
      const key = `${row.shift_log_id}|${String(row.machine_code || '').toUpperCase()}`;
      crmCountByLogMachine.set(key, Number(row.count || 0));
    }

    const masterByProcess = new Map<number, string[]>();
    for (const row of masterMachineRows) {
      if (row.process_id == null) continue;
      const list = masterByProcess.get(row.process_id) ?? [];
      if (row.machine_code) list.push(String(row.machine_code).toUpperCase());
      masterByProcess.set(row.process_id, list);
    }

    // Non-CRM process entry totals (one query per distinct process table).
    const nonCrmCountByLog = new Map<string, number>();
    const byProcessTable = new Map<string, string[]>();
    for (const log of logs) {
      const table = ShiftLogService.getProcessTable(log.processId);
      if (!table || table === 'txn.crm_order') continue;
      const list = byProcessTable.get(table) ?? [];
      list.push(String(log.id));
      byProcessTable.set(table, list);
    }
    await Promise.all(
      [...byProcessTable.entries()].map(async ([table, ids]) => {
        const rows = await db
          .selectFrom(table as any)
          .select(['shift_log_id', db.fn.countAll<number>().as('count')])
          .where('shift_log_id', 'in', ids as any)
          .groupBy('shift_log_id')
          .execute();
        for (const row of rows) {
          nonCrmCountByLog.set(String(row.shift_log_id), Number(row.count || 0));
        }
      }),
    );

    const expanded: CardRow[] = [];

    for (const log of logs) {
      const logId = String(log.id);
      const plantDay = postgresDateOnly(
        sessionDayByLog.get(logId)?.day || String(log.shiftDate).slice(0, 10),
      );
      const overrideCount = overrideByLog.get(logId) ?? 0;
      const processTable = ShiftLogService.getProcessTable(log.processId);
      const isCrm = processTable === 'txn.crm_order';

      let machines: string[] = [];
      if (log.millType) {
        machines = [String(log.millType).toUpperCase()];
      } else {
        const fromSessions = sessionMachinesByLog.get(logId);
        const fromOrders = orderMachinesByLog.get(logId);
        if (fromSessions) machines.push(...fromSessions);
        if (fromOrders) {
          for (const m of fromOrders) {
            if (!machines.includes(m)) machines.push(m);
          }
        }
        if (machines.length === 0 && log.processId) {
          machines = [...(masterByProcess.get(log.processId) ?? [])];
        }
      }

      // Non-CRM tables have no machine column — one card (avoid inflated duplicate counts).
      if (!isCrm && machines.length > 1) {
        machines = [machines[0]];
      }
      if (machines.length === 0) machines = [''];

      for (const machine of machines) {
        let entryCount = 0;
        if (isCrm) {
          entryCount = machine
            ? (crmCountByLogMachine.get(`${logId}|${machine}`) ?? 0)
            : [...crmCountByLogMachine.entries()]
                .filter(([k]) => k.startsWith(`${logId}|`))
                .reduce((s, [, n]) => s + n, 0);
        } else if (processTable) {
          entryCount = nonCrmCountByLog.get(logId) ?? 0;
        }

        expanded.push({
          id: logId,
          shiftDate: plantDay,
          shiftCode: String(log.shiftCode).toUpperCase(),
          processLine: String(log.processLine),
          submittedBy: log.submittedBy || 'Unknown',
          submittedAt: log.submittedAt,
          state: String(log.state),
          entryCount,
          overrideCount,
          millType: log.millType ? String(log.millType).toUpperCase() : null,
          machine,
          machines: machine ? [machine] : [],
        });
      }
    }

    // One machine · one shift · one plant day — collapse duplicate shift_log siblings.
    const byKey = new Map<string, CardRow>();
    for (const card of expanded) {
      if (shiftDate && card.shiftDate !== postgresDateOnly(shiftDate)) continue;
      const key = `${card.shiftDate}|${card.shiftCode}|${card.machine || card.processLine}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, card);
        continue;
      }
      const prevScore = prev.entryCount * 10 + (prev.state === 'DRAFT' || prev.state === 'REOPENED' ? 1 : 0);
      const nextScore = card.entryCount * 10 + (card.state === 'DRAFT' || card.state === 'REOPENED' ? 1 : 0);
      if (nextScore > prevScore) byKey.set(key, card);
    }

    res.json([...byKey.values()]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/active/:processCode', requireLineAccess('READ'), async (req, res) => {
  try {
    const processCode = req.params.processCode;
    const process = await db.selectFrom('master.process').select('process_id').where('code', '=', processCode).executeTakeFirst();
    if (!process) return res.status(404).json({ error: 'Process not found' });

    const requestedDate = typeof req.query.date === 'string' ? formatPlantDate(req.query.date) : undefined;
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

      if (!activeLog && processCode === 'ROLLING' && req.user) {
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

    const sessionPlantDay = await db
      .selectFrom('txn.machine_shift_session')
      .select(sql<string>`(prod_date::date)::text`.as('plantDay'))
      .where('shift_log_id', '=', activeLog.shift_log_id)
      .orderBy('started_at', 'desc')
      .executeTakeFirst();

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
    if (processCode === 'ROLLING') {
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
      shiftDate: postgresDateOnly(
        sessionPlantDay?.plantDay || formatPlantDate(activeLog.prod_date),
      ),
      shiftCode: activeLog.shift_code,
      targetMt: Number(activeLog.target_mt || 0),
      producedMt: totalProducedMt,
      stoppages: stoppagesRaw.map(s => ({
        id: String(s.id),
        code: s.code,
        reason: s.reason,
        fromTime: s.start_at ? formatPlantTime(new Date(s.start_at)) : '',
        toTime: s.end_at ? formatPlantTime(new Date(s.end_at)) : null,
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

// Composed shift-review bundle (Task 4) — reuses ReportingService.getShiftReview.
router.get('/:id/review', async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'READ');
    const machine =
      typeof req.query.machine === 'string' && req.query.machine.trim()
        ? req.query.machine.trim().toUpperCase()
        : undefined;
    const review = await ReportingService.getShiftReview(req.params.id, machine);
    if (!review) {
      return res.status(404).json({ error: 'Shift log not found' });
    }
    res.json(review);
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

router.put('/:id/complete', requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'WRITE');
    const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks : undefined;
    await ShiftLogService.completeFromReview(req.params.id, req.user!.id, remarks);
    res.json({ success: true });
  } catch (error: any) {
    const msg = error.message ?? '';
    const status =
      msg.includes('Forbidden') || msg.includes('read-only')
        ? 403
        : msg.includes('not found')
          ? 404
          : /Only active \(DRAFT or REOPENED\)/i.test(msg)
            ? 409
            : 400;
    res.status(status).json({ error: error.message });
  }
});

/** SPEC2 §13 — MH backfill for AUTO_COMPLETED shifts only. */
router.patch(
  '/:id/manual-fields',
  requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN]),
  async (req, res) => {
    try {
      await assertShiftLogAccess(req.user!, req.params.id, 'WRITE');
      await ShiftLogService.updateManualFields(req.params.id, req.user!.id, {
        scrapKg: req.body?.scrapKg ?? req.body?.scrap_kg,
        coolantTempDegC: req.body?.coolantTempDegC ?? req.body?.coolant_temp_degc,
        coolantPressKgCm2: req.body?.coolantPressKgCm2 ?? req.body?.coolant_press_kgcm2,
        remarks: req.body?.remarks,
      });
      res.json({ success: true });
    } catch (error: any) {
      const status =
        error.message?.includes('Forbidden') || error.message?.includes('only allowed')
          ? 403
          : 400;
      res.status(status).json({ error: error.message });
    }
  },
);

/** SPEC2 §13 B3 — operator in-shift coolant/scrap readings. */
router.put('/:id/readings', async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'WRITE');
    await ShiftLogService.upsertShiftReadings(req.params.id, req.user!.id, {
      scrapKg: req.body?.scrapKg ?? req.body?.scrap_kg,
      coolantTempDegC: req.body?.coolantTempDegC ?? req.body?.coolant_temp_degc,
      coolantPressKgCm2: req.body?.coolantPressKgCm2 ?? req.body?.coolant_press_kgcm2,
    });
    res.json({ success: true });
  } catch (error: any) {
    const status =
      error.message?.includes('Forbidden') || error.message?.includes('read-only') ? 403 : 400;
    res.status(status).json({ error: error.message });
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
