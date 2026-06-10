import { useState, type ComponentType, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '../../../lib/authStore';
import ZedralLogo from '../../../assets/white logo.png';
import { LogoutConfirmModal } from '../../ui/LogoutConfirmModal';

export interface DeskNavItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  path: string;
  match: (pathname: string) => boolean;
}

interface DeskSideNavProps {
  brandLabel: string;
  brandSubtitle: string;
  items: DeskNavItem[];
  footer?: ReactNode;
  ariaLabel: string;
}

const NAV_WIDTH = 'w-[200px]';

export function deskNavOffsetClass() {
  return 'ml-[200px]';
}

export function DeskSideNav({ brandLabel, brandSubtitle, items, footer, ariaLabel }: DeskSideNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const itemActive = 'bg-white/20 text-white border border-white/30';
  const itemIdle = 'text-white/70 hover:text-white hover:bg-white/10 border border-transparent';

  return (
    <nav
      className={`${NAV_WIDTH} fixed inset-y-0 left-0 z-40 h-screen overflow-hidden border-r border-[#0f241c] bg-nav flex flex-col py-3 text-nav-foreground`}
      aria-label={ariaLabel}
    >
      <div className="px-4 pb-3 border-b border-white/10 mb-2 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <img src={ZedralLogo} alt="Zedral" className="h-8 w-8 object-contain shrink-0" />
          <span className="font-mono text-sm font-bold tracking-tight text-white">{brandLabel}</span>
        </div>
        <p className="text-[10px] uppercase tracking-[0.14em] text-white/60">{brandSubtitle}</p>
      </div>

      <div className="flex flex-col gap-0.5 px-2 flex-1 min-h-0 overflow-y-auto">
        {items.map(({ id, label, icon: Icon, path, match }) => {
          const active = match(location.pathname);
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(path)}
              className={[
                'px-3 py-2.5 flex items-center gap-2.5 rounded-lg text-left text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50',
                active ? itemActive : itemIdle,
              ].join(' ')}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="font-medium">{label}</span>
            </button>
          );
        })}
      </div>

      {footer && <div className="shrink-0 px-3 pt-2 border-t border-white/10">{footer}</div>}

      <button
        type="button"
        title="End Session"
        onClick={() => setLogoutOpen(true)}
        className={[
          'mx-2 mb-1 mt-2 shrink-0 px-3 py-2.5 flex items-center gap-2.5 rounded-lg transition-colors',
          itemIdle,
        ].join(' ')}
      >
        <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="text-sm font-medium">Logout</span>
      </button>

      <LogoutConfirmModal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={logout}
      />
    </nav>
  );
}
