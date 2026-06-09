import { db } from '../../db';
import type { CoilLineageNode } from './types';
import { toNumber } from './lineArea';

/**
 * Walks coil.parent_coil_no chain (spec source_coil_no) and resolves for_ctl routing.
 * for_ctl_flag is derived from CRS for_ctl_mt on the coil (coil table has no flag column).
 */
export class CoilLineageWalker {
  static async walkLineage(coilNo: string): Promise<CoilLineageNode[]> {
    const nodes: CoilLineageNode[] = [];
    let current: string | null = coilNo;

    while (current) {
      const coil = await db
        .selectFrom('coil.coil')
        .select(['coil_no', 'parent_coil_no', 'grade_code', 'weight_mt', 'next_dest'])
        .where('coil_no', '=', current)
        .executeTakeFirst();

      if (!coil) break;

      const forCtl = await this.resolveForCtlFlag(coil.coil_no, coil.next_dest);
      nodes.push({
        coilNo: coil.coil_no,
        parentCoilNo: coil.parent_coil_no,
        forCtlFlag: forCtl,
        gradeCode: coil.grade_code,
        weightMt: toNumber(coil.weight_mt),
      });

      current = coil.parent_coil_no;
    }

    return nodes;
  }

  static async resolveForCtlFlag(
    coilNo: string,
    nextDest: string | null,
  ): Promise<boolean> {
    if (nextDest?.toUpperCase() === 'CTL') return true;

    const crs = await db
      .selectFrom('txn.prod_crs')
      .select('for_ctl_mt')
      .where('coil_no', '=', coilNo)
      .orderBy('entry_id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return (toNumber(crs?.for_ctl_mt) ?? 0) > 0;
  }

  /** Returns lineage from root parent → leaf child. */
  static async walkLineageRootFirst(coilNo: string): Promise<CoilLineageNode[]> {
    const chain = await this.walkLineage(coilNo);
    return chain.reverse();
  }

  /** Resolves bundle IDs (BNDL-*) to a parent coil via CTL remarks. */
  static async resolveTargetCoil(query: string): Promise<string> {
    const trimmed = query.trim();
    if (!trimmed.toUpperCase().startsWith('BNDL-')) return trimmed;

    const ctlMatch = await db
      .selectFrom('txn.prod_ctl')
      .select('coil_no')
      .where('remarks', 'ilike', `%${trimmed}%`)
      .executeTakeFirst();

    return ctlMatch?.coil_no ?? trimmed;
  }

  /** Coil numbers from target leaf → root parent. */
  static async lineageChain(coilNo: string): Promise<string[]> {
    const nodes = await this.walkLineage(coilNo);
    return nodes.map((n) => n.coilNo);
  }

  /** Depth map: root HR coil = 0, leaf = max. */
  static lineageDepthMap(chainChildToParent: string[]): Map<string, number> {
    const max = chainChildToParent.length - 1;
    return new Map(chainChildToParent.map((c, i) => [c, max - i]));
  }
}
