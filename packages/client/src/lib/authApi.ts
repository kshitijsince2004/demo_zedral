import { apiClient } from './apiClient';

export const authApi = {
  verifyPin: (pin: string) => apiClient.post<{ ok: boolean }>('/auth/verify-pin', { pin }),

  supervisorOverride: (pin: string, fieldLabel?: string) =>
    apiClient.post<{ ok: boolean; supervisorUsername: string }>('/auth/supervisor-override', {
      pin,
      fieldLabel,
    }),
};
