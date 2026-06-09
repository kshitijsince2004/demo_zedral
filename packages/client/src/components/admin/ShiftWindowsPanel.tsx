import { useCallback, useEffect, useState } from 'react';
import { AdminPanel } from './AdminPanel';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { shiftAdminService, type ShiftWindow } from '../../lib/shiftAdminService';

export function ShiftWindowsPanel() {
  const [windows, setWindows] = useState<ShiftWindow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { start: string; end: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await shiftAdminService.getWindows();
      setWindows(res.windows);
      const next: Record<string, { start: string; end: string }> = {};
      for (const w of res.windows) {
        next[w.shift_code] = { start: w.start_time, end: w.end_time };
      }
      setDrafts(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load shift windows');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (shiftCode: string) => {
    const draft = drafts[shiftCode];
    if (!draft) return;
    setSaving(shiftCode);
    setError(null);
    try {
      const res = await shiftAdminService.updateWindow(shiftCode, draft.start, draft.end);
      setWindows(res.windows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  };

  return (
    <AdminPanel title="Shift windows (IST)">
      {loading && <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
      {!loading && (
        <div className="divide-y divide-border">
          {windows.map((w) => (
            <div key={w.shift_code} className="px-4 py-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[80px]">
                <p className="text-xs text-muted-foreground">Shift</p>
                <p className="font-semibold">{w.shift_code} · {w.name}</p>
              </div>
              <label className="text-xs flex flex-col gap-1">
                Start
                <ZInput
                  value={drafts[w.shift_code]?.start ?? w.start_time}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [w.shift_code]: { ...d[w.shift_code], start: e.target.value },
                    }))
                  }
                  className="w-24 font-mono"
                />
              </label>
              <label className="text-xs flex flex-col gap-1">
                End
                <ZInput
                  value={drafts[w.shift_code]?.end ?? w.end_time}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [w.shift_code]: { ...d[w.shift_code], end: e.target.value },
                    }))
                  }
                  className="w-24 font-mono"
                />
              </label>
              <ZButton
                variant="accent"
                size="sm"
                onClick={() => save(w.shift_code)}
                disabled={saving === w.shift_code}
              >
                {saving === w.shift_code ? 'Saving…' : 'Save'}
              </ZButton>
            </div>
          ))}
        </div>
      )}
    </AdminPanel>
  );
}
