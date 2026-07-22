import { apiClient } from './apiClient';
import { postQueued, putQueued, deleteQueued } from './sync/queuedApi';

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

  create: async (payload: { machineCode: string; memberName: string; roleLabel: string }) => {
    const result = await postQueued<{ id: string }>('/machine-crew', payload, `crew:${payload.machineCode}`);
    return result.data ?? { id: result.id };
  },

  update: async (crewId: string, payload: { machineCode: string; memberName?: string; roleLabel?: string }) => {
    await putQueued(`/machine-crew/${encodeURIComponent(crewId)}`, payload, `crew:${payload.machineCode}`);
  },

  remove: async (crewId: string, machineCode: string) => {
    await deleteQueued(
      `/machine-crew/${encodeURIComponent(crewId)}?machineCode=${encodeURIComponent(machineCode)}`,
      `crew:${machineCode}`,
    );
  },
};
