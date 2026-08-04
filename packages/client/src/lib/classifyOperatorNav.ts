import { isCrmMillCode } from './millConfig';
import { isMillPath } from './millPath';
import { isProcessStationCode } from './processConfig';

/** CRM vs process nav — must not treat user-scope process URLs as CRM (debug H-F). */
export function classifyOperatorNav(processCode: string, pathname: string) {
  const isProcess = isProcessStationCode(processCode);
  const isCrm = !isProcess && (isCrmMillCode(processCode) || isMillPath(pathname));
  const isPkl = processCode === 'PKL';
  const isAnn = processCode === 'ANN';
  const isHrs = processCode === 'HRS';
  const isRwd = processCode === 'RWD';
  return {
    isProcess,
    isCrm,
    isPkl,
    isAnn,
    isHrs,
    isRwd,
    /** Order history tab for HRS/RWD/PKL/ANN. */
    wantsHistory: isAnn || isHrs || isRwd || isPkl,
  };
}
