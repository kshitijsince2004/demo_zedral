import React, { useCallback, useState, useEffect } from 'react';
import { validationConfigService } from '../../services/validationConfigService';
import { FIELD_REGISTRY, computeEffectiveRuleset } from '@m1/shared-validation';
import type { ValidationRule } from '@m1/shared-validation';
import { Plus, Edit2, ShieldAlert } from 'lucide-react';
import { ConfirmationDialog } from '../../components/admin/ConfirmationDialog';

type RuleType = ValidationRule['type'];
type RuleFormParams = Record<string, unknown>;
type RuleFormState = Omit<Partial<ValidationRule>, 'type' | 'params'> & {
  type?: RuleType;
  params?: RuleFormParams;
};

function paramsOf(params: RuleFormState['params']): RuleFormParams {
  return params ?? {};
}

function buildRulePayload(formState: RuleFormState): Omit<ValidationRule, 'fieldId' | 'origin'> | null {
  const severity = formState.severity ?? 'WARN';
  const isActive = formState.isActive ?? true;
  const params = paramsOf(formState.params);

  switch (formState.type) {
    case 'MANDATORY':
      return { type: 'MANDATORY', severity, isActive, params: { mandatory: Boolean(params.mandatory ?? true) } };
    case 'RANGE':
      return {
        type: 'RANGE',
        severity,
        isActive,
        params: {
          min: typeof params.min === 'number' ? params.min : undefined,
          max: typeof params.max === 'number' ? params.max : undefined,
        },
      };
    case 'STEP':
      return {
        type: 'STEP',
        severity,
        isActive,
        params: { step: typeof params.step === 'number' ? params.step : 0 },
      };
    case 'PATTERN':
      return {
        type: 'PATTERN',
        severity,
        isActive,
        params: { pattern: typeof params.pattern === 'string' ? params.pattern : '' },
      };
    case 'ALLOWED_VALUES':
      return {
        type: 'ALLOWED_VALUES',
        severity,
        isActive,
        params: {
          values: Array.isArray(params.values) ? params.values.filter((value): value is string => typeof value === 'string') : [],
        },
      };
    default:
      return null;
  }
}

export const ValidationRulesAdmin: React.FC = () => {
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [version, setVersion] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  
  // Selected state for dialog
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formState, setFormState] = useState<RuleFormState>({
    type: 'MANDATORY',
    severity: 'WARN',
    isActive: true,
    params: { mandatory: true },
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [r, v] = await Promise.all([
        validationConfigService.getConfiguredRules(),
        validationConfigService.getVersion()
      ]);
      setRules(r);
      setVersion(v);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const effective = computeEffectiveRuleset(rules, version);

  const handleEdit = (fieldId: string) => {
    setSelectedField(fieldId);
    
    // Find if we have an existing configurable rule
    const existingRule = effective.rules[fieldId]?.find(r => r.origin === 'CONFIGURER');
    if (existingRule) {
      setFormState({ ...existingRule });
    } else {
      setFormState({
        type: 'MANDATORY',
        severity: 'WARN',
        isActive: true,
        params: { mandatory: true },
      });
    }
    
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedField || !formState.type) return;
    
    try {
      const payload = buildRulePayload(formState);
      if (!payload) return;
      await validationConfigService.updateRule(selectedField, payload);
      setDialogOpen(false);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('Failed to save rule: ' + String(err));
    }
  };

  if (loading) return <div className="p-8">Loading rules...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Configurable Validation Rules</h1>
          <p className="text-slate-500 mt-1">Manage dynamic input constraints across all processes.</p>
        </div>
        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2">
          <ShieldAlert size={16} />
          Active Ruleset v{version}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-medium text-slate-900">Field ID</th>
              <th className="px-6 py-4 font-medium text-slate-900">Type</th>
              <th className="px-6 py-4 font-medium text-slate-900">Severity</th>
              <th className="px-6 py-4 font-medium text-slate-900">Status</th>
              <th className="px-6 py-4 font-medium text-slate-900 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {FIELD_REGISTRY.map(field => {
              const activeRules = effective.rules[field.fieldId] || [];
              const configRule = activeRules.find(r => r.origin === 'CONFIGURER');
              
              return (
                <tr key={field.fieldId} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium font-mono text-slate-700">{field.fieldId}</td>
                  <td className="px-6 py-4">
                    {configRule ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-medium">
                        {configRule.type}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Default</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {configRule && (
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${
                        configRule.severity === 'BLOCK' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {configRule.severity}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {configRule ? (
                      configRule.isActive ? (
                        <span className="text-emerald-600 font-medium">Active</span>
                      ) : (
                        <span className="text-slate-400">Inactive</span>
                      )
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleEdit(field.fieldId)}
                      className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium"
                    >
                      {configRule ? <Edit2 size={16} /> : <Plus size={16} />}
                      {configRule ? 'Edit' : 'Configure'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmationDialog
        isOpen={dialogOpen}
        title={`Configure Validation: ${selectedField}`}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleSave}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Rule Type</label>
            <select
              className="w-full rounded-lg border-slate-200 px-3 py-2 border shadow-sm focus:ring-2 focus:ring-blue-500"
              value={formState.type || 'MANDATORY'}
              onChange={e => setFormState({ ...formState, type: e.target.value as RuleType, params: {} })}
            >
              <option value="MANDATORY">MANDATORY</option>
              <option value="RANGE">RANGE</option>
              <option value="STEP">STEP</option>
              <option value="ALLOWED_VALUES">ALLOWED_VALUES</option>
              <option value="PATTERN">PATTERN</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Severity</label>
            <select
              className="w-full rounded-lg border-slate-200 px-3 py-2 border shadow-sm focus:ring-2 focus:ring-blue-500"
              value={formState.severity}
              onChange={e => setFormState({ ...formState, severity: e.target.value as 'BLOCK'|'WARN' })}
            >
              <option value="WARN">WARN (Overrideable)</option>
              <option value="BLOCK">BLOCK (Strict)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <input
              type="checkbox"
              id="isActive"
              checked={formState.isActive}
              onChange={e => setFormState({ ...formState, isActive: e.target.checked })}
              className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
            />
            <label htmlFor="isActive" className="text-sm text-slate-700">Rule is active</label>
          </div>
          
          {/* Params editor based on type */}
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 mt-4 space-y-3">
            <h4 className="text-sm font-medium text-slate-900 mb-2">Rule Parameters</h4>
            
            {formState.type === 'MANDATORY' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(paramsOf(formState.params).mandatory ?? true)}
                  onChange={e => setFormState({ ...formState, params: { mandatory: e.target.checked } })}
                  className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span className="text-sm">Value is mandatory</span>
              </div>
            )}
            
            {formState.type === 'RANGE' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Min Value</label>
                  <input
                    type="number"
                    value={typeof paramsOf(formState.params).min === 'number' ? String(paramsOf(formState.params).min) : ''}
                    onChange={e => setFormState({ ...formState, params: { ...paramsOf(formState.params), min: e.target.value ? Number(e.target.value) : undefined } })}
                    className="w-full rounded-md border-slate-300 px-3 py-1.5 border"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Max Value</label>
                  <input
                    type="number"
                    value={typeof paramsOf(formState.params).max === 'number' ? String(paramsOf(formState.params).max) : ''}
                    onChange={e => setFormState({ ...formState, params: { ...paramsOf(formState.params), max: e.target.value ? Number(e.target.value) : undefined } })}
                    className="w-full rounded-md border-slate-300 px-3 py-1.5 border"
                  />
                </div>
              </div>
            )}

            {formState.type === 'STEP' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Step (Multiple of)</label>
                <input
                  type="number"
                  step="0.01"
                  value={typeof paramsOf(formState.params).step === 'number' ? String(paramsOf(formState.params).step) : ''}
                  onChange={e => setFormState({ ...formState, params: { step: Number(e.target.value) } })}
                  className="w-full rounded-md border-slate-300 px-3 py-1.5 border"
                />
              </div>
            )}
            
            {formState.type === 'PATTERN' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Regex Pattern</label>
                <input
                  type="text"
                  value={typeof paramsOf(formState.params).pattern === 'string' ? paramsOf(formState.params).pattern as string : ''}
                  onChange={e => setFormState({ ...formState, params: { pattern: e.target.value } })}
                  className="w-full rounded-md border-slate-300 px-3 py-1.5 border font-mono text-sm"
                  placeholder="^[A-Z0-9]+$"
                />
              </div>
            )}

            {formState.type === 'ALLOWED_VALUES' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Allowed Values (comma separated)</label>
                <input
                  type="text"
                  value={(Array.isArray(paramsOf(formState.params).values) ? paramsOf(formState.params).values : []).join(', ')}
                  onChange={e => {
                    const values = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                    setFormState({ ...formState, params: { values } });
                  }}
                  className="w-full rounded-md border-slate-300 px-3 py-1.5 border"
                  placeholder="OK, REJECT, HOLD"
                />
              </div>
            )}
          </div>
        </div>
      </ConfirmationDialog>
    </div>
  );
};
