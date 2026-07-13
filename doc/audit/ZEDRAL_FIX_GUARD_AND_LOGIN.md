# Zedral M1 — Fixes for the two HIGH issues

Copy-paste-ready patches, grounded in the actual current code. Two independent fixes:
**Fix 1** = CRM machine guard (server); **Fix 2** = staff login on SuperTokens (client).

---

# Fix 1 — CRM guard rejects real users (`requireCrmMill`)

## Root cause (confirmed)
`requireCrmMill` calls `assertLineOperation(req.user, machine, operation)` with `machine ∈
{6HI,4HI,2HI}`. But `getUserWithRolesAndAccess` builds `lineScopes` from `master.process.code`,
which migration `1925…001` recoded from `6HI` → **`ROLLING`**. So every CRM user's line scope is now
`ROLLING`, and a check for `6HI/4HI/2HI` never matches → only ADMIN/PLANT_HEAD (who bypass) get in.

The right axis is **machine access**: `security.machine_access` stores the mill codes
(`6HI/4HI/2HI`), and `assertMachineAccess(user, code)` already exists with the ADMIN/PLANT_HEAD
carve-out. **The seed already grants operators `machines: ['6HI']` and machine-heads
`['6HI','4HI','2HI']`**, so this fix does not lock out seeded users.

## Patch — `packages/server/src/routes/sixHiRoutes.ts`

**1. Add the import** (near the existing `assertLineOperation` / `parseCrmMillCode` imports):
```ts
import { assertMachineAccess } from '../auth/machineAccessPolicy';
```
`assertLineOperation` may still be used elsewhere in the file — only remove its import if nothing
else references it after this change.

**2. Replace the guard body.** Current:
```ts
function requireCrmMill(operation: LineAccessLevel) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      const machineRaw = String(req.body?.machine ?? req.query?.machine ?? '6HI').toUpperCase();
      const machine = parseCrmMillCode(machineRaw);
      if (!machine) {
        return res.status(400).json({ error: 'Invalid or missing CRM mill code (expected 6HI, 4HI, or 2HI)' });
      }
      assertLineOperation(req.user, machine, operation);   // ← breaks after ROLLING recode
      next();
    } catch (e) {
      res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
  };
}
```
New:
```ts
// operation kept in the signature so the 42 call sites (requireSixHi('READ'|'WRITE')) don't change.
function requireCrmMill(_operation: LineAccessLevel) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      const machineRaw = String(req.body?.machine ?? req.query?.machine ?? '6HI').toUpperCase();
      const machine = parseCrmMillCode(machineRaw);
      if (!machine) {
        return res.status(400).json({ error: 'Invalid or missing CRM mill code (expected 6HI, 4HI, or 2HI)' });
      }
      // Machine-wise scope: security.machine_access holds 6HI/4HI/2HI; ADMIN/PLANT_HEAD bypass inside.
      assertMachineAccess(req.user, machine);
      next();
    } catch (e: unknown) {
      res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
  };
}
```

> **Granularity note:** `assertMachineAccess` is binary (has-machine or not), whereas
> `assertLineOperation` distinguished READ/WRITE/APPROVE. For the CRM terminal this is fine — anyone
> assigned the machine operates it, and role gates (`requireRole`) + `assertShiftLogApproval` still
> guard approvals. If you later want per-operation levels on a machine, extend `machine_access` with
> an `access_level` column and reintroduce `_operation`. Not needed now.

## Data: operators for 4HI / 2HI
Seeded 6HI operators keep working. Any operator who should run **4HI or 2HI** needs a
`security.machine_access` row for that mill — grant it via the admin Machine-Assignment UI, or SQL:
```sql
INSERT INTO security.machine_access (user_id, machine_code)
SELECT u.user_id, '4HI' FROM security.app_user u WHERE u.emp_code = '<badge>'
ON CONFLICT DO NOTHING;
```

## Minor seed consistency fixes
- `packages/server/scripts/seed-crm6-ppc.mjs:120` — change the reseed `(31,'6HI','6HI',31,FALSE)` →
  `(31,'ROLLING','Rolling',31,FALSE)` so a fresh seed matches the `ROLLING` recode.
- `packages/server/scripts/seed-pilot-users.mjs:44-45` — in the `lines` arrays, replace `'6HI'` with
  `'ROLLING'` (the process code) so `line_access` still resolves after recode. (`machines` arrays are
  already correct — they use `6HI/4HI/2HI`.)

## Test — `packages/server/tests/…` (add)
```ts
// machine-wise CRM access
it('4HI machine-head: 200 on machine=4HI, 403 on machine=6HI', async () => {
  const mh = makeUser({ roles: ['MACHINE_HEAD'], machineAccess: ['4HI'] });
  await request(app).get('/6hi/queue?machine=4HI').set(authFor(mh)).expect(200);
  await request(app).get('/6hi/queue?machine=6HI').set(authFor(mh)).expect(403);
});
it('6HI operator keeps access', async () => {
  const op = makeUser({ roles: ['OPERATOR'], machineAccess: ['6HI'] });
  await request(app).get('/6hi/queue?machine=6HI').set(authFor(op)).expect(200);
});
it('PLANT_HEAD bypasses machine scope', async () => {
  const ph = makeUser({ roles: ['PLANT_HEAD'], machineAccess: [] });
  await request(app).get('/6hi/queue?machine=2HI').set(authFor(ph)).expect(200);
});
```
**Done when:** these pass and `npm run build && npm test` green.

---

# Fix 2 — Staff login on SuperTokens (client)

## What's actually already there (good news)
The session plumbing is wired: `main.tsx` runs `SuperTokens.init({ recipeList:[EmailPassword.init(),
Session.init()] , apiDomain: VITE_API_URL, apiBasePath:'/auth' })`, and `App.tsx` has a
`SuperTokensSync` that reads `useSessionContext()` and, when a session exists, hydrates `authStore`
from `payload.roles/lineAccess/machineAccess`. The **operator** flow in `Login.tsx` already works:
`/badge-pin` sets an ST cookie, the code hits the `else → window.location.href = '/'` branch, and on
reload `SuperTokensSync` picks it up.

So three things are actually missing/wrong:
1. **No staff email+password sign-in path** — staff have ST EmailPassword accounts (the seed creates
   them for role_id 3/4/5) but the UI only offers badge/PIN.
2. **Dead legacy-token code** — `decodeToken`, `finishLegacyLogin`, and the `if (data.accessToken)`
   branch reference a JWT the server no longer returns.
3. **`apiClient` still JWT-oriented** (Patch C) — it attaches `Authorization: Bearer` and does its own
   `/auth/refresh`, and lacks `credentials:'include'`. Until this is fixed the ST cookie from
   `/badge-pin` may not be stored, so **even the operator flow isn't reliably working yet** despite the
   cookie fallback being wired. Patch C is the one that makes both operator and staff logins actually land.

## Patch A — add staff email+password to `packages/client/src/pages/Login.tsx`

**1. Import the ST EmailPassword sign-in helper** (top of file):
```ts
import { signIn } from 'supertokens-web-js/recipe/emailpassword';
```

**2. Add a mode toggle + staff state** (inside the component, with the other `useState`s):
```ts
const [mode, setMode] = useState<'operator' | 'staff'>('operator');
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
```

**3. Add the staff submit handler** (next to `handleOperatorLogin`):
```ts
const handleStaffLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');
  try {
    const res = await signIn({
      formFields: [
        { id: 'email', value: email.trim() },
        { id: 'password', value: password },
      ],
    });
    if (res.status === 'WRONG_CREDENTIALS_ERROR') {
      setError('Incorrect email or password.');
      return;
    }
    if (res.status === 'FIELD_ERROR') {
      setError(res.formFields.map((f) => f.error).join(' '));
      return;
    }
    // Session cookie is set; reload so SuperTokensSync hydrates the store + routes by role.
    window.location.href = '/';
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : 'Sign-in failed');
  }
};
```

**4. Render a toggle + the staff form.** Add a small switch above the form, and render the staff form
when `mode === 'staff'`:
```tsx
<div className="flex gap-2 mb-2">
  <button type="button" onClick={() => setMode('operator')}
    className={mode === 'operator' ? 'font-semibold underline' : 'text-muted-foreground'}>
    Operator (badge + PIN)
  </button>
  <span className="text-muted-foreground">·</span>
  <button type="button" onClick={() => setMode('staff')}
    className={mode === 'staff' ? 'font-semibold underline' : 'text-muted-foreground'}>
    Staff (email)
  </button>
</div>

{mode === 'staff' ? (
  <form onSubmit={handleStaffLogin} className="p-5 flex flex-col gap-4">
    {error && <div className="…error box…">{error}</div>}
    <ZInput label="Email" type="email" value={email}
      onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
    <ZInput label="Password" type="password" value={password}
      onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
    <ZButton type="submit" variant="accent" fullWidth size="lg">Sign in</ZButton>
  </form>
) : (
  /* existing operator badge/PIN <form onSubmit={handleOperatorLogin}> … */
)}
```
Keep the operator form exactly as-is inside the `else` branch. Admin/Plant-Head/Machine-Head use the
Staff tab; line operators use the Operator tab (default). On operator tablets you can force
`mode='operator'` and hide the toggle.

## Patch B — delete the dead legacy-token code in `Login.tsx`
Remove these now-unreachable pieces (server no longer returns `accessToken`):
- the `decodeToken(...)` function,
- the `finishLegacyLogin(...)` function,
- in `handleOperatorLogin`, collapse the branch to always use cookies:
```ts
const handleOperatorLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');
  try {
    await apiClient.post('/auth/badge-pin', { badgeId, pin });
    window.location.href = '/';   // ST cookie set → SuperTokensSync hydrates on reload
  } catch (err: unknown) {
    const apiErr = err as { status?: number; message?: string; body?: { error?: string } };
    setError(apiErr.body?.error || apiErr.message || 'Invalid badge or PIN');
  }
};
```
You can also drop the unused `login` from `useAuthStore()` and the `finishLegacyLogin` import chain if
nothing else uses them in this file.

## Patch C — migrate `apiClient` off JWT onto ST cookies (`packages/client/src/lib/apiClient.ts`)
This is more than a one-liner: `apiClient` is **still JWT-oriented** — it attaches
`Authorization: Bearer ${token}` (line ~57) and runs its own `/auth/refresh` 401-retry (line ~132),
both of which the server no longer supports. `SuperTokens.init()` (via `supertokens-web-js`) overrides
the **global `fetch`** to attach the session cookie and auto-refresh, and `apiClient` uses global
`fetch`, so it will ride on that automatically once you stop fighting it. Do:

1. **Add credentials** to every request so cookies are sent/stored:
   ```ts
   const res = await fetch(url, { ...fetchOptions, headers, credentials: 'include' });
   ```
2. **Remove** the manual `Authorization: Bearer` header attach (the token is gone; ST adds its own).
3. **Remove** the custom `/auth/refresh` 401-retry block — ST's fetch interceptor handles refresh.
   (Also retire `authSession.ts::scheduleAccessTokenRefresh` and the `token` field usage that fed it;
   `SuperTokensSync` already stores a `'st-session'` sentinel instead of a JWT.)
4. Keep `credentials: 'include'` consistent with server CORS `credentials: true` (present in `app.ts`
   line 53) and `CORS_ORIGIN` listing the exact web/APK origins.

`buildAuthHeaders` (the "Bearer headers for fetch calls that bypass apiClient" helper, line ~53) is
used by the offline **sync batch** path — repoint that to `credentials:'include'` too, or it will send
a stale/empty Bearer and 401.

## Server side — confirm staff sessions carry claims (already implemented, just verify)
`app.ts` `Session.init` overrides `createNewSession` to merge roles/lineAccess/machineAccess via
`getAuthUserBySuperTokensId(userId)`. That override runs for **EmailPassword** sign-ins too, so staff
sessions get the same claims `SuperTokensSync` reads. Verify `getAuthUserBySuperTokensId` maps the ST
user id → `security.app_user.supertokens_user_id` (populated by
`scripts/migrate-staff-to-supertokens.mjs` / the seed). If a staff `app_user` has no
`supertokens_user_id`, their session will have empty claims → they'd land with no role.

## Test / acceptance
- [ ] Staff: sign in with a seeded email (e.g. `machinehead@zedral.local`) + password → lands on the
  role home with correct role/machine scope.
- [ ] Operator: badge `3000` / PIN `1234` → operator workspace (unchanged UX).
- [ ] Override-PIN (kiosk exit / field override) still works (untouched).
- [ ] `npm run build` (client) green; no references to `decodeToken`/`finishLegacyLogin` remain.

---

## Order to apply
1. **Fix 1** (server guard) — small, isolated, unblocks the CRM terminal. Ship first.
2. **Fix 2** (client staff login) — Patch A+B+C together; verify claims (server) as the last check.

Both are independent of each other and of the prod-compose SuperTokens blocker (separate item).
