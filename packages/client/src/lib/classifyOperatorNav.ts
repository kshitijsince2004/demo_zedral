import { isCrmMillCode } from './millConfig';
import { isMillPath } from './millPath';
import { isProcessStationCode } from './processConfig';

/** CRM vs process nav — must not treat user-scope process URLs as CRM (debug H-F). */
export function classifyOperatorNav(processCode: string, pathname: string) {
  const isProcess = isProcessStationCode(processCode);
  const isCrm = !isProcess && (isCrmMillCode(processCode) || isMillPath(pathname));
  return {
    isProcess,
    isCrm,
    isPkl: processCode === 'PKL',
    isAnn: processCode === 'ANN',
  };
}
