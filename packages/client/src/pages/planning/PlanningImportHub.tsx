import { useMemo, useState } from 'react';
import { LogOut } from 'lucide-react';
import { PpcRollingImportPanel } from '../../components/admin/PpcRollingImportPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { useAuthStore } from '../../lib/authStore';
import type { PpcXlsxSheetType } from '../../services/adminService';

type ImportTab =
  | { id: string; label: string; lockedSheetType: PpcXlsxSheetType; line?: 'HRS' | 'PKL' | 'RWD' | 'ANN' | 'CTL' };

const TABS: ImportTab[] = [
  { id: 'hrs', label: 'HRS', lockedSheetType: 'HRS', line: 'HRS' },
  { id: 'pkl', label: 'PKL', lockedSheetType: 'PKL', line: 'PKL' },
  { id: 'ann', label: 'ANN', lockedSheetType: 'ANNEALING', line: 'ANN' },
  { id: 'rwd', label: 'RWD', lockedSheetType: 'REWINDING', line: 'RWD' },
  { id: 'ctl', label: 'CTL', lockedSheetType: 'CTL', line: 'CTL' },
  { id: 'rolling', label: 'Rolling', lockedSheetType: 'ROLLING' },
  { id: 'skin', label: 'Skin Pass', lockedSheetType: 'SKIN_PASS' },
];

/** Planning-Lite hub — import-only; no MH/plant chrome. */
export function PlanningImportHub() {
  const logout = useAuthStore((s) => s.logout);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const [tabId, setTabId] = useState(TABS[0]!.id);

  const visibleTabs = useMemo(() => {
    const lines = (lineAccess ?? []).map((l) => l.toUpperCase());
    // CRM rolling/skin need no line scope; always offered.
    return TABS.filter((t) => !t.line || lines.includes(t.line));
  }, [lineAccess]);

  const active = visibleTabs.find((t) => t.id === tabId) ?? visibleTabs[0] ?? TABS[0]!;

  return (
    <div className="theme-operator min-h-screen z-op-canvas">
      <header className="border-b border-border bg-background px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Planning import</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Import plans for assigned lines only
          </p>
        </div>
        <ZButton variant="ghost" size="sm" onClick={() => void logout()} aria-label="Log out">
          <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          Log out
        </ZButton>
      </header>

      <div className="px-4 pt-3 flex flex-wrap gap-2 border-b border-border bg-background">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTabId(t.id)}
            className={[
              'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              active.id === t.id
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <main className="p-4 max-w-6xl mx-auto">
        {visibleTabs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line access assigned for plan import.</p>
        ) : (
          <PpcRollingImportPanel
            key={active.id}
            lockedSheetType={active.lockedSheetType}
            line={active.line}
          />
        )}
      </main>
    </div>
  );
}
