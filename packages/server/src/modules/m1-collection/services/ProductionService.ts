import type {
  M1ANNForm,
  M1CRSForm,
  M1CTLForm,
  M1HRSForm,
  M1PKLForm,
  M1RWDForm,
  M1SKPForm,
} from '@m1/shared-validation';
import { currentPlantDate, plantClockDate } from '@m1/shared-validation';
import type { Kysely } from 'kysely';
import { db, type Database } from '../../../db';
import { derivedChildCoilNo } from '../../../utils/childCoil';
import { mapPlanSurfaceToCode } from '../../../utils/rwdFieldMappers';
import { emitProductionCaptured } from '../../../services/journeyHandoff';

function emptyToNull(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

type DbConn = Kysely<Database>;

/** Mint mother-slot coils so prod_*_slit.child_coil_no FK can land. */
export async function ensureSlitChildCoils(
  trx: DbConn,
  motherCoilNo: string,
  slits: Array<{
    slot: string;
    widthMm?: number | null;
    thkMm?: number | null;
    weightMt?: number | null;
    hold?: boolean;
  }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const mother = await trx
    .selectFrom('coil.coil')
    .selectAll()
    .where('coil_no', '=', motherCoilNo)
    .executeTakeFirst();
  if (!mother) return out;

  for (const slit of slits) {
    const label = slit.slot.trim().toUpperCase();
    if (!label) continue;
    const coilNo = derivedChildCoilNo(motherCoilNo, label);
    await trx
      .insertInto('coil.coil')
      .values({
        coil_no: coilNo,
        grade_code: mother.grade_code,
        customer_id: mother.customer_id,
        parent_coil_no: motherCoilNo,
        nominal_width_mm: slit.widthMm ?? mother.nominal_width_mm,
        coil_width_mm: slit.widthMm ?? mother.coil_width_mm,
        coil_thk_mm: slit.thkMm ?? mother.coil_thk_mm,
        weight_mt: slit.weightMt ?? null,
        status: slit.hold ? 'HOLD' : 'PLANNED',
      })
      .onConflict((oc) => oc.column('coil_no').doNothing())
      .execute();
    out.set(label, coilNo);
  }
  return out;
}

/** Resolve reading clock: HH:mm → plant timestamptz, else Date parse. */
function readingInstant(time: string): Date {
  const t = time.trim();
  if (/^\d{1,2}:\d{2}/.test(t)) return plantClockDate(currentPlantDate(), t.slice(0, 5));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function latestByTime<T extends { time: string }>(readings: T[] | undefined): T | undefined {
  if (!readings?.length) return undefined;
  return [...readings].sort(
    (a, b) => readingInstant(a.time).getTime() - readingInstant(b.time).getTime(),
  ).at(-1);
}

export class ProductionService {
  static async saveHrs(entry: M1HRSForm, opts?: { draft?: boolean }): Promise<string> {
    const draft = opts?.draft === true;
    const latestMotherWidth = latestByTime(entry.motherWidthReadings);
    const actualWidthMm = latestMotherWidth?.widthMm ?? entry.actualWidthMm ?? null;
    const status = draft
      ? 'IN_PROGRESS'
      : (emptyToNull(entry.status) ?? 'COMPLETED');

    const headerValues = {
      shift_log_id: entry.shiftLogId,
      sl_no: entry.slNo ?? null,
      coil_no: entry.coilNo,
      nominal_width_mm: entry.nominalWidthMm ?? null,
      actual_width_mm: actualWidthMm,
      nominal_thk_mm: entry.nominalThkMm ?? null,
      weight_mt: entry.weightMt ?? null,
      mother_coil_weight_mt: entry.motherCoilWeightMt ?? null,
      source: emptyToNull(entry.source),
      grade_code: emptyToNull(entry.gradeCode),
      actual_slit_width_from_mm: entry.actualSlitWidthFromMm ?? null,
      actual_slit_width_to_mm: entry.actualSlitWidthToMm ?? null,
      scrap_mt: entry.scrapMt ?? null,
      scrap_pct: entry.scrapPct ?? null,
      net_runtime_min: entry.netRuntimeMin ?? null,
      status,
      crew_ref: emptyToNull(entry.crewRef),
      setting_count: entry.settingCount ?? null,
      spec_version_id: entry.specVersionId ?? null,
      time_from: entry.timeFrom ?? null,
      time_to: entry.timeTo ?? null,
      remarks: emptyToNull(entry.remarks),
    };

    const row = await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('txn.prod_hrs')
        .select('entry_id')
        .where('coil_no', '=', entry.coilNo)
        .where('shift_log_id', '=', entry.shiftLogId)
        .orderBy('entry_id', 'desc')
        .executeTakeFirst();

      let entryId: string | number;
      const priorBySlot = new Map<string, {
        hold_flag: boolean;
        hold_reason: string | null;
        hold_remarks: string | null;
        held_at: Date | null;
        held_by: number | null;
      }>();
      if (existing) {
        await trx
          .updateTable('txn.prod_hrs')
          .set(headerValues as never)
          .where('entry_id', '=', existing.entry_id)
          .execute();
        entryId = existing.entry_id;
        const priorHolds = await trx
          .selectFrom('txn.prod_hrs_slit')
          .select(['slot', 'hold_flag', 'hold_reason', 'hold_remarks', 'held_at', 'held_by'])
          .where('entry_id', '=', entryId)
          .execute();
        for (const s of priorHolds) {
          priorBySlot.set(s.slot.trim().toUpperCase(), {
            hold_flag: !!s.hold_flag,
            hold_reason: s.hold_reason,
            hold_remarks: s.hold_remarks,
            held_at: s.held_at ? new Date(s.held_at as Date) : null,
            held_by: s.held_by,
          });
        }
        await trx.deleteFrom('txn.prod_hrs_slit_reading').where('entry_id', '=', entryId).execute();
        await trx.deleteFrom('txn.prod_hrs_slit').where('entry_id', '=', entryId).execute();
        await trx.deleteFrom('txn.prod_hrs_width_reading').where('entry_id', '=', entryId).execute();
      } else {
        const created = await trx
          .insertInto('txn.prod_hrs')
          .values(headerValues as never)
          .returning('entry_id')
          .executeTakeFirstOrThrow();
        entryId = created.entry_id;
      }

      if (entry.motherWidthReadings?.length) {
        await trx.insertInto('txn.prod_hrs_width_reading').values(
          entry.motherWidthReadings.map((r) => ({
            entry_id: entryId,
            reading_time: readingInstant(r.time),
            actual_width_mm: r.widthMm,
          })),
        ).execute();
      }

      if (entry.slitSlots?.length) {
        const childNos = await ensureSlitChildCoils(
          trx,
          entry.coilNo,
          entry.slitSlots.map((slot) => ({
            slot: slot.slot,
            widthMm: slot.targetWidthMm ?? slot.widthMm ?? null,
            thkMm: latestByTime(slot.thicknessReadings)?.thkMm
              ?? slot.thkLatestMm
              ?? slot.plannedThkMm
              ?? null,
            weightMt: slot.plannedWeightMt ?? null,
            hold: slot.holdFlag ?? false,
          })),
        );
        await trx.insertInto('txn.prod_hrs_slit').values(
          entry.slitSlots.map((slot) => {
            const target = slot.targetWidthMm ?? slot.widthMm ?? null;
            const thkLatest = latestByTime(slot.thicknessReadings)?.thkMm
              ?? slot.thkLatestMm
              ?? null;
            const taperLatest = latestByTime(slot.taperReadings)?.taper
              ?? emptyToNull(slot.taperLatest)
              ?? emptyToNull(slot.taper);
            const slotKey = slot.slot.trim().toUpperCase();
            const hold = slot.holdFlag ?? false;
            const prior = hold ? priorBySlot.get(slotKey) : undefined;
            return {
              entry_id: entryId,
              slot: slot.slot,
              width_mm: target,
              target_width_mm: target,
              actual_width_mm: null,
              thk_mm: null,
              planned_thk_mm: slot.plannedThkMm ?? null,
              // ponytail: retire ID/Centre/OD writes; columns stay nullable
              thk_id_mm: null,
              thk_centre_mm: null,
              thk_od_mm: null,
              thk_latest_mm: thkLatest,
              planned_weight_mt: slot.plannedWeightMt ?? null,
              actual_weight_mt: null,
              taper: taperLatest,
              taper_latest: taperLatest,
              child_coil_no: childNos.get(slotKey) ?? null,
              customer: emptyToNull(slot.customer),
              sap_batch_number: emptyToNull(slot.sapBatchNumber),
              surface_finish: emptyToNull(slot.surfaceFinish),
              finish_thickness_mm: slot.finishThicknessMm ?? null,
              route_raw: emptyToNull(slot.routeRaw),
              resolved_next_step: emptyToNull(slot.resolvedNextStep),
              downstream_crs_combination: emptyToNull(slot.downstreamCrsCombination),
              hold_flag: hold,
              hold_reason: hold ? (prior?.hold_reason ?? null) : null,
              hold_remarks: hold ? (prior?.hold_remarks ?? null) : null,
              held_at: hold ? (prior?.held_at ?? null) : null,
              held_by: hold ? (prior?.held_by ?? null) : null,
              for_ctl_flag: slot.forCtlFlag ?? false,
            };
          }),
        ).execute();

        const slitReadings = entry.slitSlots.flatMap((slot) => {
          const thkRows = (slot.thicknessReadings ?? []).map((r) => ({
            entry_id: entryId,
            slot: slot.slot,
            reading_time: readingInstant(r.time),
            thk_mm: r.thkMm,
            taper: null as string | null,
          }));
          const taperRows = (slot.taperReadings ?? []).map((r) => ({
            entry_id: entryId,
            slot: slot.slot,
            reading_time: readingInstant(r.time),
            thk_mm: null as number | null,
            taper: r.taper,
          }));
          return [...thkRows, ...taperRows];
        });
        if (slitReadings.length) {
          await trx.insertInto('txn.prod_hrs_slit_reading').values(slitReadings).execute();
        }
      }

      return entryId;
    });

    const id = String(row);
    if (!draft) {
      await emitProductionCaptured('HRS', entry.shiftLogId, id, entry.coilNo);
    }
    return id;
  }

  static async savePkl(entry: M1PKLForm, opts?: { draft?: boolean }): Promise<string> {
    const draft = opts?.draft === true;
    const status = draft
      ? 'IN_PROGRESS'
      : (emptyToNull(entry.status) ?? 'COMPLETED');

    const values = {
      shift_log_id: entry.shiftLogId,
      sl_no: entry.slNo ?? null,
      coil_no: entry.coilNo,
      width_mm: entry.widthMm ?? null,
      thk_mm: entry.thkMm ?? null,
      weight_mt: entry.weightMt ?? null,
      ppc_weight_mt: entry.ppcWeightMt ?? null,
      line_speed_mpm: entry.lineSpeedMpm ?? null,
      heat_no: emptyToNull(entry.heatNo),
      source: emptyToNull(entry.source),
      wip: emptyToNull(entry.wip),
      leader_end: emptyToNull(entry.leaderEnd),
      repeats: entry.repeats ?? 0,
      wp: entry.wp ?? null,
      end_filling: entry.endFilling ?? null,
      ht: emptyToNull(entry.ht),
      mother_coil_no: emptyToNull(entry.motherCoilNo),
      slit_id: emptyToNull(entry.slitId),
      customer: emptyToNull(entry.customer),
      grade_code: emptyToNull(entry.gradeCode),
      route_raw: emptyToNull(entry.routeRaw),
      status,
      crew_ref: emptyToNull(entry.crewRef),
      total_time_min: entry.totalTimeMin ?? null,
      time_from: entry.timeFrom ?? null,
      time_to: entry.timeTo ?? null,
      remarks: emptyToNull(entry.remarks),
    };

    const row = await db.transaction().execute(async (trx) => {
      // Upsert latest row for this coil+shift so Save can run repeatedly without ending.
      const existing = await trx
        .selectFrom('txn.prod_pkl')
        .select('entry_id')
        .where('coil_no', '=', entry.coilNo)
        .where('shift_log_id', '=', entry.shiftLogId)
        .orderBy('entry_id', 'desc')
        .executeTakeFirst();

      let entryId: string;
      if (existing) {
        await trx
          .updateTable('txn.prod_pkl')
          .set(values as never)
          .where('entry_id', '=', existing.entry_id)
          .execute();
        entryId = String(existing.entry_id);
      } else {
        const created = await trx
          .insertInto('txn.prod_pkl')
          .values(values as never)
          .returning('entry_id')
          .executeTakeFirstOrThrow();
        entryId = String(created.entry_id);
      }

      if (entry.charts?.length) {
        for (const chart of entry.charts) {
          const tankNo = chart.tankNo ?? null;
          let existingQ = trx.selectFrom('txn.prod_pkl_chart')
            .select('chart_id')
            .where('shift_log_id', '=', entry.shiftLogId)
            .where('chart_time', '=', chart.chartTime);
          existingQ = tankNo == null
            ? existingQ.where('tank_no', 'is', null)
            : existingQ.where('tank_no', '=', tankNo);
          const existing = await existingQ.executeTakeFirst();
          const values = {
            shift_log_id: entry.shiftLogId,
            chart_time: chart.chartTime,
            tank_no: tankNo,
            tank_level: chart.tankLevel ?? null,
            tank_temp_degc: chart.tankTempDegc ?? null,
            acid_strength_pct: chart.acidStrengthPct ?? null,
            iron_strength_pct: chart.ironStrengthPct ?? null,
            steam_inlet_kgcm2: chart.steamInletKgcm2 ?? null,
            steam_outlet_kgcm2: chart.steamOutletKgcm2 ?? null,
            dosage_acid: chart.dosageAcid ?? null,
            dosage_water: chart.dosageWater ?? null,
            dosage_inhibitor: chart.dosageInhibitor ?? null,
            rinse_cl: chart.rinseCl ?? null,
            rinse_ph: chart.rinsePh ?? null,
            rinse_flow: chart.rinseFlow ?? null,
            rinse_temp_degc: chart.rinseTempDegc ?? null,
            rinse_acid_pct: chart.rinseAcidPct ?? null,
            rinse_iron_pct: chart.rinseIronPct ?? null,
            burner_pressure_kgcm2: chart.burnerPressureKgcm2 ?? null,
            hot_air_temp_degc: chart.hotAirTempDegc ?? null,
          };
          if (existing) {
            await trx.updateTable('txn.prod_pkl_chart').set(values as never).where('chart_id', '=', existing.chart_id).execute();
          } else {
            await trx.insertInto('txn.prod_pkl_chart').values(values as never).execute();
          }
        }
      }

      return entryId;
    });

    // Draft saves must not emit production.captured (completion side-effects).
    if (!draft) {
      await emitProductionCaptured('PKL', entry.shiftLogId, row, entry.coilNo);
    }
    return row;
  }

  static async saveAnn(entry: M1ANNForm): Promise<string> {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('txn.ann_charge')
        .values({
          charge_no: entry.chargeNo,
          base_no: emptyToNull(entry.baseNo),
          shift_log_id: entry.shiftLogId,
          furnace_id: entry.furnaceId ?? null,
          grade_code: emptyToNull(entry.gradeCode),
          no_of_coils: entry.noOfCoils ?? null,
          charge_wt_mt: entry.chargeWtMt ?? null,
          status: entry.status,
          dew_point_n2: entry.dewPointN2 ?? null,
          dew_point_h2: entry.dewPointH2 ?? null,
          temperature_degc: entry.temperatureDegc ?? null,
          exp_unloading_time: entry.expUnloadingTime ? new Date(entry.expUnloadingTime) : null,
          unloading_wt_mt: entry.unloadingWtMt ?? null,
          loading_mt: entry.loadingMt ?? null,
          unloading_mt: entry.unloadingMt ?? null,
          cumm_loading_mt: entry.cummLoadingMt ?? null,
          cumm_unloading_mt: entry.cummUnloadingMt ?? null,
        })
        .execute();

      await trx
        .insertInto('txn.ann_charge_coil')
        .values({
          charge_no: entry.chargeNo,
          coil_no: entry.coilNo,
          seq_no: entry.slNo ?? null,
        })
        .execute();
    });

    await emitProductionCaptured('ANN', entry.shiftLogId, entry.chargeNo, entry.coilNo);
    return entry.chargeNo;
  }

  static async saveSkp(entry: M1SKPForm): Promise<string> {
    const orderId = await db.transaction().execute(async (trx) => {
      let batch = await trx
        .selectFrom('planning.ppc_batch')
        .select('batch_id')
        .where('batch_number', '=', 'ARCHIVE-LEGACY')
        .executeTakeFirst();
      if (!batch) {
        batch = await trx
          .insertInto('planning.ppc_batch')
          .values({
            batch_number: 'ARCHIVE-LEGACY',
            plan_date: new Date(),
            shift_code: 'A',
            machine_code: '6HI',
            sub_process: 'ROLLING',
            queue_seq: 9999,
            width_mm: 0,
            ppc_thk_mm: 0,
            ppc_weight_mt: 0,
            grade_code: 'ARCHIVE',
            customer_name: 'ARCHIVE',
            coil_no: 'ARCHIVE-COIL',
            input_thk_mm: 0,
          })
          .returning('batch_id')
          .executeTakeFirstOrThrow();
      }
      const order = await trx
        .insertInto('txn.crm_order')
        .values({
          shift_log_id: entry.shiftLogId,
          batch_id: batch.batch_id,
          batch_number: 'ARCHIVE-LEGACY',
          coil_no: entry.coilNo,
          customer_name: 'ARCHIVE',
          grade_code: 'ARCHIVE',
          width_mm: entry.widthMm ?? 0,
          ppc_thk_mm: entry.thkMm ?? 0,
          ppc_weight_mt: entry.weightMt ?? 0,
          sub_process: 'SKINPASS',
          status: 'COMPLETED',
          prod_duration_min: 0,
          production_day: new Date(),
        })
        .returning('order_id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('txn.crm_skinpass')
        .values({
          order_id: order.order_id,
          actual_weight_mt: entry.wtSkinpassMt ?? entry.weightMt ?? null,
          output_thk_mm: entry.finalThkMm ?? null,
          rw_tension_1: entry.rwTensionKg ?? null,
        })
        .execute();
      return order.order_id;
    });

    const id = String(orderId);
    // ponytail: SKP not in ADVANCE_PROCESSES; skin-pass advances via SixHi inline path
    return id;
  }

  static async saveRwd(entry: M1RWDForm): Promise<string> {
    // prod_rwd.surface_finish FK → master.surface_finish (B/M only). Map plan labels.
    const surface = mapPlanSurfaceToCode(entry.surfaceFinish);
    const row = await db
      .insertInto('txn.prod_rwd')
      .values({
        shift_log_id: entry.shiftLogId,
        sl_no: entry.slNo ?? null,
        coil_no: entry.coilNo,
        width_mm: entry.widthMm ?? null,
        thk_mm: entry.thkMm ?? null,
        output_thk_mm: entry.outputThkMm ?? null,
        weight_mt: entry.weightMt ?? null,
        rw_tension_1_kg: entry.rwTension1Kg ?? null,
        rw_tension_2_kg: entry.rwTension2Kg ?? null,
        rw_tension_3_kg: entry.rwTension3Kg ?? null,
        surface_finish: surface,
        time_from: entry.timeFrom ?? null,
        time_to: entry.timeTo ?? null,
        remarks: emptyToNull(entry.remarks),
      })
      .returning('entry_id')
      .executeTakeFirstOrThrow();

    const id = String(row.entry_id);
    await emitProductionCaptured('RWD', entry.shiftLogId, id, entry.coilNo);
    return id;
  }

  static async saveCrs(entry: M1CRSForm): Promise<string> {
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('txn.prod_crs')
        .values({
          shift_log_id: entry.shiftLogId,
          sl_no: entry.slNo ?? null,
          coil_no: entry.coilNo,
          slit_no: emptyToNull(entry.slitNo),
          coil_width_mm: entry.coilWidthMm ?? null,
          nominal_thk_mm: entry.nominalThkMm ?? null,
          actual_width_mm: entry.actualWidthMm ?? null,
          actual_thk_front_mm: entry.actualThkFrontMm ?? null,
          actual_thk_rear_mm: entry.actualThkRearMm ?? null,
          hardness_vpn: entry.hardnessVpn ?? null,
          hardness_hrb: entry.hardnessHrb ?? null,
          ib_tiecv: emptyToNull(entry.ibTiecv),
          uts_nmm2: entry.utsNmm2 ?? null,
          elongation_pct: entry.elongationPct ?? null,
          ysr_burr: emptyToNull(entry.ysrBurr),
          camber_waviness: emptyToNull(entry.camberWaviness),
          ra_um: entry.raUm ?? null,
          rz_um: entry.rzUm ?? null,
          output_wt_mt: entry.outputWtMt ?? null,
          scrap_mt: entry.scrapMt ?? null,
          input_wt_mt: entry.inputWtMt ?? null,
          setting_count: entry.settingCount ?? null,
          rejection_od_mt: entry.rejectionOdMt ?? null,
          rejection_id_mt: entry.rejectionIdMt ?? null,
          coating_wt_br: entry.coatingWtBr ?? null,
          coating_wt_matt: entry.coatingWtMatt ?? null,
          rp_oil_grade: emptyToNull(entry.rpOilGrade),
          hold_mt: entry.holdMt ?? null,
          for_ctl_mt: entry.forCtlMt ?? null,
          crew_ref: emptyToNull(entry.crewRef),
          spec_version_id: entry.specVersionId ?? null,
          remarks: emptyToNull(entry.remarks),
        })
        .returning('entry_id')
        .executeTakeFirstOrThrow();

      if (entry.slitSlots?.length) {
        const childNos = await ensureSlitChildCoils(
          trx,
          entry.coilNo,
          entry.slitSlots.map((slot) => ({
            slot: slot.slot,
            widthMm: slot.widthMm ?? slot.finishWidthMm ?? null,
            thkMm: slot.actualThkFrontMm ?? null,
            weightMt: slot.outputWtMt ?? null,
            hold: slot.holdFlag ?? false,
          })),
        );
        await trx.insertInto('txn.prod_crs_slit').values(
          entry.slitSlots.map((slot) => ({
            entry_id: created.entry_id,
            slot: slot.slot,
            width_mm: slot.widthMm ?? slot.finishWidthMm ?? null,
            child_coil_no: childNos.get(slot.slot.trim().toUpperCase()) ?? null,
            slit_no: emptyToNull(slot.slitNo),
            finish_width_mm: slot.finishWidthMm ?? slot.widthMm ?? null,
            no_of_slit: slot.noOfSlit ?? null,
            actual_width_mm: slot.actualWidthMm ?? null,
            actual_thk_front_mm: slot.actualThkFrontMm ?? null,
            actual_thk_rear_mm: slot.actualThkRearMm ?? null,
            output_wt_mt: slot.outputWtMt ?? null,
            scrap_mt: slot.scrapMt ?? null,
            rejection_od_mt: slot.rejectionOdMt ?? null,
            rejection_id_mt: slot.rejectionIdMt ?? null,
            hold_flag: slot.holdFlag ?? false,
            for_ctl_flag: slot.forCtlFlag ?? false,
            route_code: emptyToNull(slot.routeCode),
            sap_batch_number: emptyToNull(slot.sapBatchNumber),
            camber_waviness: emptyToNull(slot.camberWaviness),
            ra_um: slot.raUm ?? null,
            rz_um: slot.rzUm ?? null,
          })),
        ).execute();
      }

      return created;
    });

    const id = String(row.entry_id);
    await emitProductionCaptured('CRS', entry.shiftLogId, id, entry.coilNo);
    return id;
  }

  static async saveCtl(entry: M1CTLForm): Promise<string> {
    // P5/R9.2: total_prod_mt is server-derived; never trust client aggregate.
    const weightMt = entry.weightMt ?? null;
    const rejectionMt = entry.rejectionMt ?? 0;
    const totalProdMt = weightMt != null ? Math.max(0, Number(weightMt) - Number(rejectionMt || 0)) : null;

    const row = await db
      .insertInto('txn.prod_ctl')
      .values({
        shift_log_id: entry.shiftLogId,
        sl_no: entry.slNo ?? null,
        coil_no: entry.coilNo,
        width_mm: entry.widthMm ?? null,
        thk_mm: entry.thkMm ?? null,
        weight_mt: weightMt,
        nominal_set_length_mm: entry.nominalSetLengthMm ?? null,
        actual_length_mm: entry.actualLengthMm ?? null,
        no_pieces: entry.noPieces ?? null,
        no_bundles: entry.noBundles ?? null,
        total_prod_mt: totalProdMt,
        hold_mt: entry.holdMt ?? null,
        rejection_mt: entry.rejectionMt ?? null,
        low_speed: emptyToNull(entry.lowSpeed),
        estimated_suppressed: emptyToNull(entry.estimatedSuppressed),
        time_from: entry.timeFrom ?? null,
        time_to: entry.timeTo ?? null,
        remarks: emptyToNull(entry.remarks),
      })
      .returning('entry_id')
      .executeTakeFirstOrThrow();

    const id = String(row.entry_id);
    await emitProductionCaptured('CTL', entry.shiftLogId, id, entry.coilNo);
    return id;
  }
}
