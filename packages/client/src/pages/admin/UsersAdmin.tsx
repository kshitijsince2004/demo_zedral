/**
 * UsersAdmin — Admin screen for User Management
 *
 * Requirements: 7.5
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { UserRole } from '@m1/shared-validation';
import { adminService, type UserAccess, type UserStatus } from '../../services/adminService';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { hasImplicitAllMachines, MACHINE_OPTIONS, resolveMachineAccess } from '../../lib/accessOptions';
import { fetchMachineRegistry } from '../../lib/machineRegistry';

export function UsersAdmin({ embedded = false }: { embedded?: boolean }) {
  const [users, setUsers] = useState<UserAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [machineOptions, setMachineOptions] = useState<string[]>([...MACHINE_OPTIONS]);

  const [editingUser, setEditingUser] = useState<UserAccess | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminService.listUsers();
      setUsers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void fetchMachineRegistry()
      .then((machines) => {
        const codes = machines.map((m) => m.machineCode);
        if (codes.length > 0) setMachineOptions(codes);
      })
      .catch(() => {
        // Keep MACHINE_OPTIONS fallback when registry is unavailable.
      });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    
    setSaveError(null);
    try {
      const { line_access, ...payload } = editingUser;
      void line_access;
      const implicitAll = hasImplicitAllMachines(editingUser.role);
      await adminService.upsertUser({
        ...payload,
        ...(implicitAll ? {} : { machine_access: editingUser.machine_access ?? [] }),
      });
      setEditingUser(null);
      await loadUsers();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save user');
    }
  };

  const statusTone = (status: UserStatus) => {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'DISABLED': return 'muted';
      case 'LOCKED': return 'destructive';
      default: return 'info';
    }
  };

  const roleTone = (role: UserRole) => {
    switch (role) {
      case 'ADMIN': return 'purple';
      case 'PLANT_HEAD': return 'info';
      case 'MACHINE_HEAD': return 'warning';
      default: return 'muted';
    }
  };

  const content = (
    <>
      {error && (
        <div className="p-3 rounded-sm border border-destructive/30 bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {!editingUser ? (
        <AdminPanel
          title="Users & access"
          actions={
            <ZButton
              variant="accent"
              size="sm"
              onClick={() =>
                setEditingUser({
                  id: '',
                  username: '',
                  display_name: '',
                  emp_code: '',
                  role: UserRole.OPERATOR,
                  status: 'ACTIVE',
                  machine_access: [],
                  email: '',
                  password: '',
                })
              }
            >
              + New user
            </ZButton>
          }
          noPadding
        >
          <div className="overflow-auto">
            <table className="w-full">
              <thead className="bg-background">
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Username</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Access</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading users...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No users found</td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const access = resolveMachineAccess(u);
                    return (
                    <tr key={u.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                      <td className="px-4 py-3 text-sm font-medium">
                        {u.username}
                        {u.emp_code && (
                          <span className="block text-[10px] font-mono text-muted-foreground">Badge: {u.emp_code}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{u.display_name}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={roleTone(u.role)} label={u.role} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={statusTone(u.status)} label={u.status} />
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground max-w-[200px] truncate">
                        {hasImplicitAllMachines(u.role) ? 'All machines' : access.length ? access.join(', ') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditingUser({ ...u, machine_access: resolveMachineAccess(u) })}
                          className="px-2 py-1 rounded text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </AdminPanel>
      ) : (
        <AdminPanel title={editingUser.id ? 'Edit user' : 'New user'} className="max-w-2xl">
          <form onSubmit={handleSave} className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Username</label>
                <input 
                  type="text" 
                  value={editingUser.username}
                  onChange={(e) => setEditingUser({...editingUser, username: e.target.value})}
                  required
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Display Name</label>
                <input 
                  type="text" 
                  value={editingUser.display_name}
                  onChange={(e) => setEditingUser({...editingUser, display_name: e.target.value})}
                  required
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Badge ID (emp_code)</label>
                <input
                  type="text"
                  value={editingUser.emp_code ?? ''}
                  onChange={(e) => setEditingUser({ ...editingUser, emp_code: e.target.value })}
                  placeholder="Shop-floor badge for PIN login"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">PIN (optional)</label>
                <input
                  type="password"
                  value={editingUser.pin ?? ''}
                  onChange={(e) => setEditingUser({ ...editingUser, pin: e.target.value })}
                  placeholder="4-digit PIN"
                  maxLength={4}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono"
                />
              </div>
            </div>

            {['ADMIN', 'PLANT_HEAD', 'MACHINE_HEAD'].includes(editingUser.role) && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Email (Required for Staff)</label>
                  <input
                    type="email"
                    value={editingUser.email ?? ''}
                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                    required
                    placeholder="staff@example.com"
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Temp password (Optional)</label>
                  <input
                    type="text"
                    value={editingUser.password ?? ''}
                    onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                    placeholder="Auto-generate if blank"
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-mono"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Role</label>
                <select 
                  value={editingUser.role}
                  onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as UserAccess['role'] })}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="OPERATOR">OPERATOR</option>
                  <option value="MACHINE_HEAD">MACHINE_HEAD</option>
                  <option value="PLANT_HEAD">PLANT_HEAD</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Status</label>
                <select 
                  value={editingUser.status}
                  onChange={(e) => setEditingUser({...editingUser, status: e.target.value as UserStatus})}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DISABLED">DISABLED</option>
                  <option value="LOCKED">LOCKED</option>
                </select>
              </div>
            </div>
            
            <div className="pt-4 border-t border-border">
              <label className="block text-xs font-medium text-foreground mb-2">Access</label>
              {hasImplicitAllMachines(editingUser.role) ? (
                <p className="text-sm text-muted-foreground">
                  Plant Head and Admin accounts automatically have access to all machines. No assignment needed.
                </p>
              ) : (
                <>
                  <p className="text-[10px] text-muted-foreground mb-3">
                    Select mills/lines for this user. Login opens the first assigned machine — 6HI is not the default.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {machineOptions.map((code) => {
                      const selected = (editingUser.machine_access ?? []).includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => {
                            const current = editingUser.machine_access ?? [];
                            const next = selected
                              ? current.filter((c) => c !== code)
                              : [...current, code];
                            setEditingUser({ ...editingUser, machine_access: next });
                          }}
                          className={[
                            'px-3 py-1.5 rounded-lg border text-xs font-bold font-mono transition-colors',
                            selected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border hover:bg-muted/30',
                          ].join(' ')}
                        >
                          {code}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {saveError && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm mt-4">
                {saveError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <ZButton type="button" variant="secondary" onClick={() => setEditingUser(null)}>
                Cancel
              </ZButton>
              <ZButton type="submit" variant="accent">
                Save user
              </ZButton>
            </div>
          </form>
        </AdminPanel>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">User Management</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Accounts, roles, and mill/line access</p>
          </div>
          <ZButton variant="secondary" size="sm" onClick={() => void loadUsers()} disabled={loading}>
            Refresh
          </ZButton>
        </div>
        {content}
      </div>
    );
  }

  return (
    <AdminShell
      title="User Management"
      subtitle="Accounts, roles, and mill/line access"
      onRefresh={loadUsers}
      refreshing={loading}
    >
      {content}
    </AdminShell>
  );
}
