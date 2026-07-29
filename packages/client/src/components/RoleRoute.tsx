import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import type { Role } from '../lib/authStore';
import { ROLE_RANK, UserRole } from '@m1/shared-validation';
import { getRoleHomePath } from '../lib/roleHome';
import { ProtectedRoute } from './ProtectedRoute';
import { ZButton } from './primitives/ZButton';

interface RoleRouteProps {
  /** Minimum role required to access this route. */
  minRole: Role;
  children: React.ReactNode;
}

/**
 * RoleRoute extends ProtectedRoute with role-based access control.
 *
 * - Unauthenticated users are redirected to /login (via ProtectedRoute).
 * - Authenticated users whose role is below `minRole` see a 403 Forbidden screen.
 * - Authenticated users who meet or exceed `minRole` see the children.
 *
 * Role hierarchy (ascending privilege):
 *   OPERATOR < MACHINE_HEAD < QUALITY < PLANT_HEAD < ADMIN
 *
 * Note: ADMIN is treated as a superuser and always passes any role check
 * (consistent with authStore.hasRole).
 *
 * Requirements: 7.6, 8.3
 */
export function RoleRoute({ minRole, children }: RoleRouteProps) {
  return (
    <ProtectedRoute>
      <RoleCheck minRole={minRole}>{children}</RoleCheck>
    </ProtectedRoute>
  );
}

function RoleCheck({ minRole, children }: RoleRouteProps) {
  const { role } = useAuthStore();

  if (!role) {
    // Should not reach here (ProtectedRoute handles unauthenticated), but guard anyway.
    return <Navigate to="/login" replace />;
  }

  const userRank = ROLE_RANK[role as UserRole];
  const requiredRank = ROLE_RANK[minRole as UserRole];

  // Unknown / legacy roles must not slip past (undefined < n is false in JS).
  if (userRank == null || requiredRank == null || userRank < requiredRank) {
    return <AccessDenied minRole={minRole} role={role} />;
  }

  return <>{children}</>;
}

function AccessDenied({ minRole, role }: { minRole: Role; role: Role }) {
  const navigate = useNavigate();
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const username = useAuthStore((s) => s.username);
  const home = getRoleHomePath(role, lineAccess, machineAccess, username);

  return (
    <div className="theme-operator min-h-screen flex items-center justify-center z-op-canvas p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-border text-center">
          <ShieldOff className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Access denied</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Requires <span className="font-semibold">{minRole}</span> or higher. Your role is{' '}
            <span className="font-semibold">{role}</span>.
          </p>
        </div>
        <div className="p-4 flex justify-center">
          <ZButton variant="accent" onClick={() => navigate(home)}>
            Return to home
          </ZButton>
        </div>
      </div>
    </div>
  );
}

/**
 * Convenience wrappers for the two common guard levels used in the routing table.
 */

/** Requires MACHINE_HEAD or higher (plant desk + review/approval routes). */
export function PlantRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute minRole={UserRole.MACHINE_HEAD}>{children}</RoleRoute>;
}

/** Requires MACHINE_HEAD or higher (machine-scoped ops). */
export function MachineHeadRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute minRole={UserRole.MACHINE_HEAD}>{children}</RoleRoute>;
}

/** Requires QUALITY or higher (spec authoring). */
export function QualityRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute minRole={UserRole.QUALITY}>{children}</RoleRoute>;
}

/** Requires ADMIN (admin routes). */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute minRole={UserRole.ADMIN}>{children}</RoleRoute>;
}
