import React from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Footer } from './Footer';
import { OfflineBanner } from '../ui/OfflineBanner';

interface ShellProps {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}

export function Shell({ title, eyebrow, children }: ShellProps) {
  return (
    <div className="min-h-screen flex bg-secondary/40 text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} eyebrow={eyebrow} />
        <main className="flex-1 w-full px-6 py-6 flex flex-col gap-6 overflow-x-hidden">
          <OfflineBanner />
          {children}
          <Footer />
        </main>
      </div>
    </div>
  );
}
