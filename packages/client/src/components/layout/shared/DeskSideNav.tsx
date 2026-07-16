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

export function DeskSideNav({ brandLabel, brandSubtitle, items, footer, ariaLabel }: DeskSideNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const [logoutOpen, setLogoutOpen] = useState(false);

  return (
    <nav
      className={`${NAV_WIDTH} z-nav-surface fixed inset-y-0 left-0 z-40 h-screen overflow-hidden border-r border-[#0f241c] flex flex-col py-4 text-nav-foreground`}
      aria-label={ariaLabel}
    >
      <div className="px-4 pb-4 mb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 shrink-0">
            <img src={ZedralLogo} alt="Zedral" className="h-6 w-6 object-contain" />
          </span>
          <span className="flex flex-col leading-tight min-w-0">
            <span className="font-mono text-sm font-bold tracking-tight text-white truncate">{brandLabel}</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/55 truncate">{brandSubtitle}</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1 px-2.5 flex-1 min-h-0 overflow-y-auto">
        {items.map(({ id, label, icon: Icon, path, match }) => {
          const active = match(location.pathname);
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(path)}
              aria-current={active ? 'page' : undefined}
              className={[
                'group relative pl-4 pr-3 py-2.5 flex items-center gap-2.5 rounded-xl text-left text-sm transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50',
                active
                  ? 'bg-white/12 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-white/65 hover:text-white hover:bg-white/8',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute left-1 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full transition-all duration-150',
                  active ? 'bg-accent opacity-100' : 'bg-accent opacity-0 group-hover:opacity-40',
                ].join(' ')}
                aria-hidden
              />
              <Icon
                className={active ? 'h-4 w-4 shrink-0 text-accent' : 'h-4 w-4 shrink-0'}
                strokeWidth={active ? 2 : 1.75}
                aria-hidden
              />
              <span className={active ? 'font-semibold' : 'font-medium'}>{label}</span>
            </button>
          );
        })}
      </div>

      {footer && <div className="shrink-0 px-3 pt-2 mt-2 border-t border-white/10">{footer}</div>}

      <div className="shrink-0 px-2.5 pt-3 mt-2 border-t border-white/10">
        <button
          type="button"
          title="End Session"
          onClick={() => setLogoutOpen(true)}
          className={[
            'w-full px-4 py-2.5 flex items-center gap-2.5 rounded-xl text-sm font-medium transition-colors',
            'text-white/70 hover:text-white hover:bg-destructive/25',
          ].join(' ')}
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>Logout</span>
        </button>
      </div>

      <LogoutConfirmModal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={logout}
      />
    </nav>
  );
}
