import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../lib/authStore';
import { GloveModeToggle } from '../ui/GloveModeToggle';
import { LogoutConfirmModal } from '../ui/LogoutConfirmModal';

interface TopbarProps {
  title: string;
  eyebrow?: string;
}

export function Topbar({ title, eyebrow }: TopbarProps) {
  const { logout } = useAuthStore();
  const [clock, setClock] = useState('');
  const [logoutOpen, setLogoutOpen] = useState(false);

  useEffect(() => {
    const tick = () => {
      const now = new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setClock(now + ' IST');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
      <div className="px-6 h-16 flex items-center gap-4">
        {/* Left: title */}
        <div className="flex flex-col">
          {eyebrow && (
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              {eyebrow}
            </span>
          )}
          <h1 className="text-lg font-semibold tracking-tight leading-tight text-foreground">
            {title}
          </h1>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right cluster */}
        <div className="flex items-center gap-3">
          {/* Glove-mode toggle (Requirement 10.2) */}
          <GloveModeToggle />

          {/* System live pill */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-success/40 bg-success/15">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-success">Live</span>
          </div>

          {/* IST Clock */}
          <span className="font-mono text-sm tracking-wider tabular-nums text-muted-foreground">
            {clock}
          </span>

          {/* Logout */}
          <button
            onClick={() => setLogoutOpen(true)}
            className="h-9 rounded-md border border-input text-foreground text-sm font-medium hover:bg-secondary px-3 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      <LogoutConfirmModal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={logout}
      />
    </header>
  );
}
