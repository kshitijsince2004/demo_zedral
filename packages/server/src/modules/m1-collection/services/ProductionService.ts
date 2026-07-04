import { buildEventEnvelope, getEventBus } from '@zedral/platform';
import type {
  M1ANNForm,
  M1CRSForm,
  M1CTLForm,
  M1HRSForm,
  M1PKLForm,
  M1RWDForm,
  M1SKPForm,
} from '@m1/shared-validation';
import { db } from '../../../db';
import { getTenantId } from '../../../context';

function emptyToNull(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function tenantIdOrDefault(): string {
  return getTenantId() ?? '00000000-0000-0000-0000-000000000001';
}

async function emitCaptured(processCode: string, shiftLogId: string, entryId: string, coilNo: string) {
  const tenantId = tenantIdOrDefault();
  await getEventBus().publish(
    buildEventEnvelope({
      type: 'production.captured',
      tenantId,
      key: `${tenantId}:production.captured:${processCode}:${entryId}`,
      lineageRef: `${processCode.toLowerCase()}:${entryId}`,
      payload: {
        processCode,
        shiftLogId,
        entryId,
        coilNo,
      },
    }),
  );
}

export class ProductionService {
  static async saveHrs(entry: M1HRSForm): Promise<string> {
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('txn.prod_hrs')
        .values({
          shift_log_id: entry.shiftLogId,
          sl_no: entry.slNo ?? null,
          coil_no: entry.coilNo,
          nominal_width_mm: entry.nominalWidthMm ?? null,
          actual_width_mm: entry.actualWidthMm ?? null,
          nominal_thk_mm: entry.nominalThkMm ?? null,
          weight_mt: entry.weightMt ?? null,
          actual_slit_width_from_mm: entry.actualSlitWidthFromMm ?? null,
          actual_slit_width_to_mm: entry.actualSlitWidthToMm ?? null,
          scrap_mt: entry.scrapMt ?? null,
          scrap_pct: entry.scrapPct ?? null,
          time_from: entry.timeFrom ?? null,
          time_to: entry.timeTo ?? null,
          remarks: emptyToNull(entry.remarks),
        })
        .returning('entry_id')
        .executeTakeFirstOrThrow();

      if (entry.slitSlots?.length) {
        await trx.insertInto('txn.prod_hrs_slit').values(
          entry.slitSlots.map((slot) => ({
            entry_id: created.entry_id,
            slot: slot.slot,
            width_mm: slot.widthMm ?? null,
            thk_mm: slot.thkMm ?? null,
            taper: emptyToNull(slot.taper),
            child_coil_no: emptyToNull(slot.childCoilNo),
          })),
        ).execute();
      }

      return created;
    });

    const id = String(row.entry_id);
    await emitCaptured('HRS', entry.shiftLogId, id, entry.coilNo);
    return id;
  }

  static async savePkl(entry: M1PKLForm): Promise<string> {
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('txn.prod_pkl')
        .values({
          shift_log_id: entry.shiftLogId,
          sl_no: entry.slNo ?? null,
          coil_no: entry.coilNo,
          width_mm: entry.widthMm ?? null,
          thk_mm: entry.thkMm ?? null,
          weight_mt: entry.weightMt ?? null,
          line_speed_mpm: entry.lineSpeedMpm ?? null,
          heat_no: emptyToNull(entry.heatNo),
          source: emptyToNull(entry.source),
          wip: emptyToNull(entry.wip),
          leader_end: emptyToNull(entry.leaderEnd),
          time_from: entry.timeFrom ?? null,
          time_to: entry.timeTo ?? null,
          remarks: emptyToNull(entry.remarks),
        })
        .returning('entry_id')
        .executeTakeFirstOrThrow();

      if (entry.charts?.length) {
        await trx.insertInto('txn.prod_pkl_chart').values(
          entry.charts.map((chart) => ({
            shift_log_id: entry.shiftLogId,
            chart_time: chart.chartTime,
            tank_no: chart.tankNo ?? null,
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
          })),
        ).execute();
      }

      return created;
    });

    const id = String(row.entry_id);
    await emitCaptured('PKL', entry.shiftLogId, id, entry.coilNo);
    return id;
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

    await emitCaptured('ANN', entry.shiftLogId, entry.chargeNo, entry.coilNo);
    return entry.chargeNo;
  }

  static async saveSkp(entry: M1SKPForm): Promise<string> {
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('txn.prod_skp')
        .values({
          shift_log_id: entry.shiftLogId,
          sl_no: entry.slNo ?? null,
          coil_no: entry.coilNo,
          width_mm: entry.widthMm ?? null,
          thk_mm: entry.thkMm ?? null,
          final_thk_mm: entry.finalThkMm ?? null,
          total_passes: entry.totalPasses ?? null,
          weight_mt: entry.weightMt ?? null,
          rw_tension_kg: entry.rwTensionKg ?? null,
          surface_finish: emptyToNull(entry.surfaceFinish),
          re_rolling: entry.reRolling ?? false,
          hold_mt: entry.holdMt ?? null,
          rejection_mt: entry.rejectionMt ?? null,
          wt_rolling_mt: entry.wtRollingMt ?? null,
          wt_reroll_mt: entry.wtRerollMt ?? null,
          wt_skinpass_mt: entry.wtSkinpassMt ?? null,
          wt_scrap_mt: entry.wtScrapMt ?? null,
          rolls_in: emptyToNull(entry.rollsIn),
          rolls_out: emptyToNull(entry.rollsOut),
          coolant_temp_degc: entry.coolantTempDegc ?? null,
          coolant_press_kgcm2: entry.coolantPressKgcm2 ?? null,
          remarks: emptyToNull(entry.remarks),
        })
        .returning('entry_id')
        .executeTakeFirstOrThrow();

      if (entry.passes?.length) {
        await trx.insertInto('txn.prod_skp_pass').values(
          entry.passes.map((pass) => ({
            entry_id: created.entry_id,
            pass_no: pass.passNo,
            thickness_mm: pass.thicknessMm ?? null,
          })),
        ).execute();
      }

      return created;
    });

    const id = String(row.entry_id);
    await emitCaptured('SKP', entry.shiftLogId, id, entry.coilNo);
    return id;
  }

  static async saveRwd(entry: M1RWDForm): Promise<string> {
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
        surface_finish: emptyToNull(entry.surfaceFinish),
        time_from: entry.timeFrom ?? null,
        time_to: entry.timeTo ?? null,
        remarks: emptyToNull(entry.remarks),
      })
      .returning('entry_id')
      .executeTakeFirstOrThrow();

    const id = String(row.entry_id);
    await emitCaptured('RWD', entry.shiftLogId, id, entry.coilNo);
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
          rejection_od_mt: entry.rejectionOdMt ?? null,
          rejection_id_mt: entry.rejectionIdMt ?? null,
          coating_wt_br: entry.coatingWtBr ?? null,
          coating_wt_matt: entry.coatingWtMatt ?? null,
          rp_oil_grade: emptyToNull(entry.rpOilGrade),
          hold_mt: entry.holdMt ?? null,
          for_ctl_mt: entry.forCtlMt ?? null,
          remarks: emptyToNull(entry.remarks),
        })
        .returning('entry_id')
        .executeTakeFirstOrThrow();

      if (entry.slitSlots?.length) {
        await trx.insertInto('txn.prod_crs_slit').values(
          entry.slitSlots.map((slot) => ({
            entry_id: created.entry_id,
            slot: slot.slot,
            width_mm: slot.widthMm ?? null,
            child_coil_no: emptyToNull(slot.childCoilNo),
          })),
        ).execute();
      }

      return created;
    });

    const id = String(row.entry_id);
    await emitCaptured('CRS', entry.shiftLogId, id, entry.coilNo);
    return id;
  }

  static async saveCtl(entry: M1CTLForm): Promise<string> {
    const row = await db
      .insertInto('txn.prod_ctl')
      .values({
        shift_log_id: entry.shiftLogId,
        sl_no: entry.slNo ?? null,
        coil_no: entry.coilNo,
        width_mm: entry.widthMm ?? null,
        thk_mm: entry.thkMm ?? null,
        weight_mt: entry.weightMt ?? null,
        nominal_set_length_mm: entry.nominalSetLengthMm ?? null,
        actual_length_mm: entry.actualLengthMm ?? null,
        no_pieces: entry.noPieces ?? null,
        no_bundles: entry.noBundles ?? null,
        total_prod_mt: entry.totalProdMt ?? null,
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
    await emitCaptured('CTL', entry.shiftLogId, id, entry.coilNo);
    return id;
  }
}
