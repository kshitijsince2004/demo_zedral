import { useMemo, useState } from 'react';
import { LogOut } from 'lucide-react';
import { PpcRollingImportPanel } from '../../components/admin/PpcRollingImportPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { useAuthStore } from '../../lib/authStore';
import { overlayClass } from '../../lib/nativeOverlay';
import ZedralLogo from '../../assets/white logo.png';
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

/** Planning-Lite hub — import-only; branded shell, no MH/plant chrome. */
export function PlanningImportHub() {
  const logout = useAuthStore((s) => s.logout);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const username = useAuthStore((s) => s.username);
  const [tabId, setTabId] = useState(TABS[0]!.id);

  const visibleTabs = useMemo(() => {
    const lines = (lineAccess ?? []).map((l) => l.toUpperCase());
    // CRM rolling/skin need no line scope; always offered.
    return TABS.filter((t) => !t.line || lines.includes(t.line));
  }, [lineAccess]);

  const active = visibleTabs.find((t) => t.id === tabId) ?? visibleTabs[0] ?? TABS[0]!;
  const who = username || 'Planner';

  return (
    <div className="theme-operator min-h-dvh flex flex-col bg-secondary text-foreground">
      {/* Brand header — matches Login / desk nav (deep green + white mark) */}
      <header className="shrink-0 border-b border-[#0f241c] bg-nav text-nav-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <img src={ZedralLogo} alt="Zedral" className="h-7 w-7 object-contain" />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-base font-bold tracking-tight text-white sm:text-lg">
                  ZEDRAL
                </span>
                <span className="hidden text-[10px] uppercase tracking-[0.18em] text-accent sm:inline">
                  Planning
                </span>
              </div>
              <p className="truncate text-[11px] text-white/55">
                Plan import · assigned lines only
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[10rem] truncate text-xs text-white/70 sm:inline" title={who}>
              {who}
            </span>
            <ZButton
              variant="ghost"
              size="sm"
              onClick={() => void logout()}
              aria-label="Log out"
              className="text-white/85 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              <span className="hidden sm:inline">Log out</span>
            </ZButton>
          </div>
        </div>
      </header>

      {/* Line tabs */}
      <div className={overlayClass('shrink-0 border-b border-border bg-background/90', 'backdrop-blur-sm')}>
        <div
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pt-3 sm:px-6"
          role="tablist"
          aria-label="Import line"
        >
          {visibleTabs.map((t) => {
            const selected = active.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTabId(t.id)}
                className={[
                  'relative shrink-0 px-3.5 pb-2.5 pt-1 text-xs font-semibold tracking-wide transition-colors',
                  selected
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {t.label}
                <span
                  className={[
                    'absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors',
                    selected ? 'bg-accent' : 'bg-transparent',
                  ].join(' ')}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 sm:py-7">
        {visibleTabs.length === 0 ? (
          <div className="rounded-lg border border-border bg-background px-5 py-10 text-center shadow-sm">
            <p className="text-sm font-medium text-foreground">No line access</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask an admin to assign plan-import lines on your account.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            <div className="border-b border-border bg-card/80 px-4 py-3 sm:px-5">
              <h1 className="text-sm font-semibold tracking-tight text-foreground">
                Import · {active.label}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Upload the plan sheet for this line. Wrong-line files are rejected by signature columns.
              </p>
            </div>
            <div className="sm:px-1">
              <PpcRollingImportPanel
                key={active.id}
                lockedSheetType={active.lockedSheetType}
                line={active.line}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
