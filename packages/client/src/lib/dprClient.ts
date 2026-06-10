import { apiClient } from './apiClient';

export const dprClient = {
  getTemplates: () => apiClient.get('/dpr/templates'),
  createTemplate: (formData: FormData) => apiClient.post('/dpr/templates', formData),
  getMonths: () => apiClient.get('/dpr/months'),
  createMonth: (data: any) => apiClient.post('/dpr/months', data),
  saveEntry: (monthId: string, data: any) => apiClient.post(`/dpr/months/${monthId}/entries`, data),
  exportMonth: (monthId: string) => apiClient.post(`/dpr/months/${monthId}/export`, {}, { responseType: 'blob' }),
  getSourceMap: () => apiClient.get('/dpr/source-map'),
  updateSourceMap: (id: string, data: any) => apiClient.put(`/dpr/source-map/${id}`, data),
};
