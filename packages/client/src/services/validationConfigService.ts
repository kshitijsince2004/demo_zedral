import type { ValidationRule } from '@m1/shared-validation';
import { getAuthHeaders } from '../lib/apiClient';

const API_BASE = '/api';

export const validationConfigService = {
  /**
   * Fetch all configured validation rules from the server.
   */
  async getConfiguredRules(): Promise<ValidationRule[]> {
    const res = await fetch(`${API_BASE}/validation-rules`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      throw new Error('Failed to fetch validation rules');
    }
    return res.json();
  },

  /**
   * Fetch the current version of the validation ruleset.
   */
  async getVersion(): Promise<number> {
    const res = await fetch(`${API_BASE}/validation-rules/version`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      throw new Error('Failed to fetch validation rules version');
    }
    const data = await res.json();
    return data.version;
  },

  /**
   * Update an existing rule or add a new configurable rule override.
   */
  async updateRule(fieldId: string, ruleData: Omit<ValidationRule, 'fieldId' | 'origin'>): Promise<void> {
    const res = await fetch(`${API_BASE}/validation-rules/${encodeURIComponent(fieldId)}`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(ruleData),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to update validation rule');
    }
  }
};
