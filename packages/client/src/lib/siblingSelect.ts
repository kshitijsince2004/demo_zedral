import type { ProcessQueueCard } from '../store/processStore';
import {
  findPklSiblingCoils,
  parsePklCoilIdentity,
  pklGroupWeightMt,
  pklSiblingKey,
} from './pklSiblingSelect';
import {
  findRwdCompatibleOrders,
  rwdCombineKey,
  rwdCombineStatusGroup,
  rwdCombinedActionLabel,
  rwdFinishGroup,
  rwdGroupWeightMt,
  type RwdCombineable,
} from './rwdSiblingSelect';

export {
  findPklSiblingCoils,
  parsePklCoilIdentity,
  pklGroupWeightMt,
  pklSiblingKey,
  findRwdCompatibleOrders,
  rwdCombineKey,
  rwdCombineStatusGroup,
  rwdCombinedActionLabel,
  rwdFinishGroup,
  rwdGroupWeightMt,
};
export type { RwdCombineable };

/** Unified sibling/combine lookup by process line. */
export function siblingSelect(
  processCode: string,
  anchor: ProcessQueueCard | RwdCombineable,
  queue: Array<ProcessQueueCard | RwdCombineable>,
): Array<ProcessQueueCard | RwdCombineable> {
  const code = processCode.toUpperCase();
  if (code === 'PKL') {
    return findPklSiblingCoils(anchor as ProcessQueueCard, queue as ProcessQueueCard[]);
  }
  if (code === 'RWD' || code === '2HI') {
    return findRwdCompatibleOrders(anchor as RwdCombineable, queue as RwdCombineable[]);
  }
  return [anchor];
}

export function siblingGroupWeightMt(
  processCode: string,
  cards: Array<{ weightMt: number }>,
): number {
  const code = processCode.toUpperCase();
  if (code === 'RWD' || code === '2HI') return rwdGroupWeightMt(cards);
  return pklGroupWeightMt(cards as ProcessQueueCard[]);
}
