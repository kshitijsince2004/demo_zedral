import React from 'react';
import { Outlet } from 'react-router-dom';
import { Activity, ArrowRightLeft, Brain, LayoutDashboard, Search, Shield, Timer, Users } from 'lucide-react';
import { DeskSideNav, type DeskNavItem, deskNavOffsetClass } from './shared/DeskSideNav';
import { OfflineBanner } from '../ui/OfflineBanner';

const SIDEBAR_ITEMS: DeskNavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    path: '/plant',
    match: (p) => p === '/plant',
  },
  {
    id: 'live',
    label: 'Live Operations',
    icon: Activity,
    path: '/plant/live',
    match: (p) => p === '/plant/live',
  },
  {
    id: 'order-assignment',
    label: 'Order Assignment',
    icon: ArrowRightLeft,
    path: '/plant/order-assignment',
    match: (p) => p === '/plant/order-assignment',
  },
  {
    id: 'traceability',
    label: 'Traceability',
    icon: Search,
    path: '/plant/orders',
    match: (p) => p === '/plant/orders',
  },
  {
    id: 'defect-intelligence',
    label: 'Defect Intelligence',
    icon: Brain,
    path: '/plant/defect-intelligence',
    match: (p) => p === '/plant/defect-intelligence',
  },
  {
    id: 'downtime-intelligence',
    label: 'Downtime Intelligence',
    icon: Timer,
    path: '/plant/downtime-intelligence',
    match: (p) => p === '/plant/downtime-intelligence',
  },
  {
    id: 'audit',
    label: 'Audit Logs',
    icon: Shield,
    path: '/plant/audit',
    match: (p) => p === '/plant/audit' || p.startsWith('/plant/audit/'),
  },
  {
    id: 'users',
    label: 'Users',
    icon: Users,
    path: '/plant/users',
    match: (p) => p === '/plant/users',
  },
];

export function PlantHeadShell() {
  return (
    <div className="theme-operator min-h-screen bg-background text-foreground">
      <DeskSideNav
        brandLabel="EXECUTIVE"
        brandSubtitle="Plant Command"
        items={SIDEBAR_ITEMS}
        ariaLabel="Plant head navigation"
      />
      
      <div className={`flex flex-col min-w-0 min-h-screen ${deskNavOffsetClass()}`}>
        <header className="shrink-0 border-b border-border bg-card px-4 md:px-5 py-4 flex flex-col gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Plant Command Center</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Executive overview and analytics</p>
          </div>
        </header>

        <OfflineBanner />
        
        <main className="flex-1 overflow-auto p-4 md:p-5 flex flex-col gap-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
