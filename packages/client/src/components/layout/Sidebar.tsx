import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import type { Role } from '../../lib/authStore';
import { getMachineNavItems } from '../../lib/machineRouting';
import { ROLE_RANK, UserRole } from '@m1/shared-validation';
import ZedralLogo from '../../assets/white logo.png';

interface NavItem {
  code: string;
  label: string;
  path: string;
  icon: string;
}

// Canonical process codes from M1_schema.sql and design document.
// SPM and REW are intentionally excluded — they are not canonical process codes.
const CANONICAL_PROCESS_CODES = ['HRS', 'PKL', '6HI', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL', 'GLV'] as const;
type ProcessCode = typeof CANONICAL_PROCESS_CODES[number];

// All possible process line definitions (canonical only)
const ALL_PROCESS_LINES: Record<ProcessCode, NavItem> = {
  HRS: { code: 'HRS', label: 'Hot Rolling',    path: '/shift-log/HRS', icon: '◉' },
  PKL: { code: 'PKL', label: 'Pickling',        path: '/shift-log/PKL', icon: '◎' },
  '6HI': { code: '6HI', label: '6HI Mill',         path: '/6hi', icon: '⊞' },
  ANN: { code: 'ANN', label: 'Annealing',       path: '/shift-log/ANN', icon: '▦' },
  SKP: { code: 'SKP', label: 'Skin Pass',       path: '/shift-log/SKP', icon: '▶' },
  RWD: { code: 'RWD', label: 'Rewind',          path: '/shift-log/RWD', icon: '◈' },
  CRS: { code: 'CRS', label: 'CR Slitter',      path: '/shift-log/CRS', icon: '⊞' },
  CTL: { code: 'CTL', label: 'Cut-to-Length',   path: '/shift-log/CTL', icon: '▦' },
  GLV: { code: 'GLV', label: 'GLV',             path: '/shift-log/GLV', icon: '◉' },
};

function meetsMinRole(userRole: Role | null, minRole: Role): boolean {
  if (!userRole) return false;
  return ROLE_RANK[userRole as UserRole] >= ROLE_RANK[minRole as UserRole];
}

/**
 * Derive the set of visible process lines for a given role + lineAccess.
 *
 * - OPERATOR: intersection of canonical codes with the user's lineAccess set.
 * - SUPERVISOR: lines in lineAccess (multi-line scope); all canonical if unset.
 * - PLANT_HEAD / ADMIN: all canonical process lines.
 *
 * Requirements: 8.1, 8.2
 */
export function getSidebarProcessLines(
  role: Role | null,
  lineAccess: string[],
): NavItem[] {
  if (!role) return [];

  return CANONICAL_PROCESS_CODES.filter((code) => {
    if (role === 'OPERATOR') {
      return lineAccess.includes(code);
    }
    if (role === 'SUPERVISOR') {
      return lineAccess.length === 0 || lineAccess.includes(code);
    }
    return true;
  }).map((code) => ALL_PROCESS_LINES[code]);
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, lineAccess, machineAccess, username } = useAuthStore();
  const [isExpanded, setIsExpanded] = useState(true);

  const isActive = (path: string) => location.pathname === path;

  const machineNav = getMachineNavItems(role, machineAccess, lineAccess, username);
  const useMachineNav =
    role === 'PLANT_HEAD' || role === 'ADMIN' || role === 'OPERATOR' || role === 'MACHINE_HEAD';
  const visibleProcessLines =
    useMachineNav && machineNav.length > 0
      ? machineNav.map((item) => ({
          code: item.code,
          label: item.label,
          path: item.path,
          icon: item.icon,
        }))
      : getSidebarProcessLines(role, lineAccess);

  // Report items visible to SUPERVISOR+ (Requirement 8.3)
  const reportItems: NavItem[] = meetsMinRole(role, UserRole.SUPERVISOR)
    ? [
        { code: 'SUP', label: 'Command',      path: '/command',             icon: '◎' },
        { code: 'PLT', label: 'Plant',        path: '/plant',               icon: '⬡' },
        { code: 'MGT', label: 'Executive',    path: '/executive',           icon: '◉' },
        { code: 'EXP', label: 'Export Data',  path: '/reports/export',      icon: '▶' },
        { code: 'REV', label: 'Review Queue', path: '/review',              icon: '◈' },
      ]
    : [];

  const adminItems: NavItem[] = meetsMinRole(role, UserRole.ADMIN)
    ? [
        { code: 'MST', label: 'Master Data',  path: '/admin/master-data',   icon: '⊞' },
        { code: 'PLN', label: 'Planning',      path: '/admin/planning',      icon: '▦' },
        { code: 'USR', label: 'Users',         path: '/admin/users',         icon: '◉' },
        { code: 'SYS', label: 'System',        path: '/admin/system',        icon: '◎' },
        { code: 'VAL', label: 'Validation',    path: '/admin/validation-rules', icon: '◈' },
      ]
    : [];

  const renderNavItem = (item: NavItem) => (
    <button
      key={item.code}
      onClick={() => navigate(item.path)}
      title={!isExpanded ? item.label : undefined}
      className={`w-full flex items-center ${isExpanded ? 'gap-3 px-3' : 'justify-center'} py-2.5 rounded-md text-left transition-colors ${
        isActive(item.path)
          ? 'bg-nav-foreground/10 text-accent'
          : 'text-nav-foreground/70 hover:text-nav-foreground hover:bg-nav-foreground/5'
      }`}
    >
      <div className="relative flex items-center justify-center">
        {isActive(item.path) && (
          <span className={`absolute ${isExpanded ? '-left-2' : '-left-1'} inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot`} />
        )}
        <span className="font-mono text-base">{item.icon}</span>
      </div>
      
      {isExpanded && (
        <div className="flex flex-col overflow-hidden">
          <span className="text-[10px] uppercase tracking-wider font-semibold truncate">{item.code}</span>
          <span className="text-xs text-nav-foreground/50 truncate">{item.label}</span>
        </div>
      )}
    </button>
  );

  return (
    <aside 
      className={`flex sticky top-0 h-screen shrink-0 flex-col bg-nav text-nav-foreground transition-all duration-300 ${
        isExpanded ? 'w-64' : 'w-16'
      }`}
    >
      {/* Header — Zedral logo + "MES SUITE" caption */}
      <div 
        className={`px-3 h-16 flex items-center cursor-pointer border-b border-nav-foreground/10 transition-colors hover:bg-nav-foreground/5 ${
          isExpanded ? 'gap-3' : 'justify-center'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
        title="Toggle Sidebar"
      >
        <img
          src={ZedralLogo}
          alt="Zedral"
          className={`h-8 w-auto shrink-0 transition-all ${isExpanded ? '' : 'scale-90'}`}
        />
        {isExpanded && (
          <span className="text-[11px] uppercase tracking-widest text-nav-foreground/50 font-medium truncate">MES SUITE</span>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 overflow-y-auto py-5 space-y-1 ${isExpanded ? 'px-3' : 'px-2'}`}>
        {/* Process Lines — scoped by role + lineAccess */}
        {visibleProcessLines.length > 0 && (
          <>
            <div className={`text-[10px] uppercase tracking-wider font-semibold text-nav-foreground/40 mt-4 mb-2 truncate ${isExpanded ? 'px-3' : 'px-1 text-center'}`}>
              {isExpanded ? 'Process Lines' : 'Line'}
            </div>
            {visibleProcessLines.map(renderNavItem)}
          </>
        )}

        {/* Reports + Review — SUPERVISOR+ */}
        {reportItems.length > 0 && (
          <>
            <div className={`text-[10px] uppercase tracking-wider font-semibold text-nav-foreground/40 mt-6 mb-2 truncate ${isExpanded ? 'px-3' : 'px-1 text-center'}`}>
              {isExpanded ? 'Reports & Review' : 'Reps'}
            </div>
            {reportItems.map(renderNavItem)}
          </>
        )}

        {/* Admin — ADMIN only */}
        {adminItems.length > 0 && (
          <>
            <div className={`text-[10px] uppercase tracking-wider font-semibold text-nav-foreground/40 mt-6 mb-2 truncate ${isExpanded ? 'px-3' : 'px-1 text-center'}`}>
              {isExpanded ? 'Admin' : 'Adm'}
            </div>
            {adminItems.map(renderNavItem)}
          </>
        )}
      </nav>

      {/* Footer card */}
      <div className={`pb-4 ${isExpanded ? 'px-3' : 'px-2'}`}>
        <div className={`rounded-md bg-nav-foreground/5 ${isExpanded ? 'p-3' : 'p-2 flex justify-center'}`}>
          <div className={`flex items-center ${isExpanded ? 'gap-2' : 'justify-center'}`}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" title="All Systems Live" />
            {isExpanded && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-nav-foreground/70 truncate">
                All Systems Live
              </span>
            )}
          </div>
          {isExpanded && (
            <div className="text-[10px] text-nav-foreground/40 mt-1 truncate">Hero Steel · Plant 1100</div>
          )}
        </div>
      </div>
    </aside>
  );
}
