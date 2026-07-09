import { apiClient } from './apiClient';

export interface MachineCrewMember {
  id: string;
  machineCode: string;
  memberName: string;
  roleLabel: string;
}

export const machineCrewService = {
  list: (machineCode: string) =>
    apiClient.get<{ crew: MachineCrewMember[] }>(
      `/machine-crew?machineCode=${encodeURIComponent(machineCode)}`,
    ),

  create: (payload: { machineCode: string; memberName: string; roleLabel: string }) =>
    apiClient.post<{ id: string }>('/machine-crew', payload),

  update: (crewId: string, payload: { machineCode: string; memberName?: string; roleLabel?: string }) =>
    apiClient.put(`/machine-crew/${encodeURIComponent(crewId)}`, payload),

  remove: (crewId: string, machineCode: string) =>
    apiClient.delete(`/machine-crew/${encodeURIComponent(crewId)}?machineCode=${encodeURIComponent(machineCode)}`),
};
