# M1-10 — Operator APK Conversion Guide (zedral_v4 → Capacitor Android)

> **Audience:** coding agent / IDE (Cursor, Antigravity). All paths are repo-relative to `zedral_v4-main`.
> **Goal:** package ONLY the M1 operator surface as an Android APK for line-mounted tablets (16 GB RAM / 128 GB storage) with offline-first capture, timely sync, and kiosk lockdown.
> **Base repo:** `zedral_v4-main` (NOT V2.1 — V2.1 lacks per-process capture and offline scaffolding).
> **Do not fork.** The APK is a second build target of `packages/client`. Web app and APK share one codebase.

---

## 0. Scope

### 0.1 Operator surface — INCLUDED in the APK

| Route (current `App.tsx`) | Page | Notes |
|---|---|---|
| `/login` | `pages/Login.tsx` | badge + PIN; gains offline mode (§7) |
| `/station`, `/` | `components/RoleHomeRedirect.tsx` | operator lands on their line |
| `/capture/:machineCode` | `pages/capture/GenericCapturePage.tsx` + `ProcessForms.tsx` | 7 process forms (HRS/PKL/ANN/SKP/RWD/CRS/CTL) |
| `/:userScope/capture` | `pages/sixHi/SixHiCapturePage.tsx` | CRM/6HI capture |
| `/:userScope/handover` | `pages/sixHi/CrmOutgoingHandoverPage.tsx` | shift handover |
| `/:userScope/shift-summary` | `pages/sixHi/SixHiShiftSummaryPage.tsx` | |
| `/:userScope/rolling`, `/skinpass`, `…/order/:batchNo` | `pages/sixHi/SixHiQueuePage.tsx`, `SixHiOrderPage.tsx` | rolling execution |
| `/coming-soon/:machineCode` | `pages/MachineComingSoon.tsx` | fallback |

Shared sub-forms (stoppage / defect / crew) come along automatically as components of the capture pages.

### 0.2 EXCLUDED from the APK bundle

Everything under `/plant/*`, `/planning/*`, `/oee/*`, `/maint/*`, `/admin/*`, `/reports/*`, `/import/*`, `/order-assignment`, `/machine-head-*`, and the whole `m3/` and `m4/` client trees. They must not appear in the operator bundle (bundle-size check in §9.4).

### 0.3 Non-goals

- No schema changes to Postgres (one additive index for idempotency, §5.6).
- No rewrite of `ProcessForms.tsx` (prototype quality is acknowledged; APK wraps it as-is).
- iOS is out of scope.

---

## 1. Phase plan (each phase independently testable on a real tablet)

| Phase | Deliverable | Sections |
|---|---|---|
| **P1** | Operator-only build target + Capacitor APK that runs online against the server | §2, §3 |
| **P2** | SQLite storage + ordered outbox sync + pull-sync of masters/plan + offline PIN | §4, §5, §6, §7 |
| **P3** | Kiosk Lock Task + provisioning + release pipeline | §8, §9 |

Acceptance tests for all phases: §10.

---

## 2. Phase 1a — Operator build target (`packages/client`)

### 2.1 New entry HTML — `packages/client/operator.html` (NEW)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>Zedral M1 Operator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/operator/main.tsx"></script>
  </body>
</html>
```

### 2.2 New operator entry — `packages/client/src/operator/main.tsx` (NEW)

Same as `src/main.tsx` but: no `virtual:pwa-register` (Capacitor replaces the PWA layer), mounts `OperatorApp`, and boots the native bridge first.

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AnalyticErrorBoundary } from '../components/shared/AnalyticErrorBoundary';
import OperatorApp from './OperatorApp';
import { initNative } from './native/init';

initNative().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AnalyticErrorBoundary analyticName="OperatorApp">
        <OperatorApp />
      </AnalyticErrorBoundary>
    </StrictMode>,
  );
});
```

### 2.3 Operator router — `packages/client/src/operator/OperatorApp.tsx` (NEW)

Copy the router skeleton from `src/App.tsx` but keep ONLY the routes in §0.1. Reuse the existing providers (auth store, theme, glove mode) exactly as `App.tsx` does. Every excluded route becomes `<Route path="*" element={<Navigate to="/station" replace />} />` — an operator can never navigate out of the operator surface even by URL.

Rules for the agent while writing this file:

1. Import pages with the SAME import paths `App.tsx` uses (check `src/App.tsx` lines ~100–240 for exact component names: `Login`, `RoleHomeRedirect`, `GenericCapturePage`, `MachineComingSoon`, `UserScopeShell`, `UserScopeIndex`, `SixHiCapturePage`, `CrmOutgoingHandoverPage`, `SixHiShiftSummaryPage`, `SixHiQueuePage`, `SixHiOrderPage`, `ProtectedRoute`).
2. Do NOT import `UnifiedShell` plant/planning nav items. If `UserScopeShell` renders cross-module nav links, add a prop `operatorMode` that hides them (small edit in that component, gated so web behavior is unchanged).
3. Mount a persistent `<SyncStatusBadge />` (§5.5) inside the shell so the "N unsynced" counter is always visible — M1-02's context-bar online/offline dot requirement.

### 2.4 Operator Vite config — `packages/client/vite.operator.config.ts` (NEW)

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Operator/APK build: no vite-plugin-pwa (Capacitor owns the app shell).
export default defineConfig({
  resolve: {
    alias: {
      '@m1/shared-validation': path.resolve(__dirname, '../shared-validation/src/index.ts'),
    },
  },
  plugins: [tailwindcss(), react()],
  define: { __OPERATOR_BUILD__: 'true' },
  build: {
    outDir: 'dist-operator',
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, 'operator.html') },
  },
});
```

Also add to `src/vite-env.d.ts`:

```ts
declare const __OPERATOR_BUILD__: boolean | undefined;
interface ImportMetaEnv { readonly VITE_API_URL?: string }
```

### 2.5 THE breaking fix — absolute API base in `packages/client/src/lib/apiClient.ts` (EDIT)

Current line ~15:

```ts
const API_BASE = '/api';
```

Inside the APK the WebView origin is `https://localhost` — relative `/api` will never reach the server. Replace with:

```ts
const API_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;
```

- Web build: `VITE_API_URL` unset → behaves exactly as today (`/api`).
- Operator build: set via `packages/client/.env.operator` → `VITE_API_URL=https://zedral.plant.local` (the on-prem server URL reachable from plant Wi-Fi).

Apply the SAME pattern to `src/api/apiClient.ts` (baseURL `import.meta.env.VITE_API_URL || '/v1/plan'` → prefix with the env host) — it is imported by shared services even if M3 screens are excluded, and a stray relative call must not silently fail.

**Server prerequisite:** CORS. The APK's origin is `https://localhost`. `packages/server/src/app.ts` (line ~56) already reads origins from the `CORS_ORIGIN` env var — no code change; just add `https://localhost,capacitor://localhost` to `CORS_ORIGIN` in the server's deployment env. Auth uses bearer/refresh via `lib/apiClient.ts` fetch — verify no cookie-only flows remain; if the refresh endpoint sets cookies, switch operator flow to header-based refresh.

### 2.6 Scripts — `packages/client/package.json` (EDIT, add)

```json
{
  "scripts": {
    "dev:operator": "vite --config vite.operator.config.ts",
    "build:operator": "vite build --config vite.operator.config.ts",
    "android:sync": "npm run build:operator && npx cap sync android",
    "android:open": "npx cap open android",
    "android:apk": "npm run android:sync && cd android && ./gradlew assembleRelease"
  }
}
```

**P1a checkpoint:** `npm run dev:operator` serves an app that only exposes operator routes; `/plant` redirects to `/station`.

---

## 3. Phase 1b — Capacitor shell

### 3.1 Install (run in `packages/client/`)

```bash
npm i @capacitor/core @capacitor/android @capacitor/network @capacitor/preferences @capacitor/app @capacitor/splash-screen
npm i -D @capacitor/cli
npm i @capacitor-community/sqlite @capacitor-community/keep-awake
npx cap init "Zedral M1 Operator" "com.zedral.m1operator" --web-dir dist-operator
npx cap add android
```

### 3.2 `packages/client/capacitor.config.ts` (NEW — `cap init` creates it; replace with)

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zedral.m1operator',
  appName: 'Zedral M1 Operator',
  webDir: 'dist-operator',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#0f172a' },
    CapacitorSQLite: { androidIsEncryption: false },
  },
};
export default config;
```

If the on-prem server is HTTP-only (no TLS inside the plant LAN), add `android: { allowMixedContent: true }` AND `android/app/src/main/res/xml/network_security_config.xml` permitting cleartext to that host only. Prefer fixing TLS on the server instead.

### 3.3 Native bootstrap — `packages/client/src/operator/native/init.ts` (NEW)

```ts
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { initDb } from '../db/sqlite';
import { startSyncEngine } from '../sync/engine';

export const isNative = () => Capacitor.isNativePlatform();

export async function initNative(): Promise<void> {
  await initDb();          // §4 — no-op fallback to idb on web dev
  startSyncEngine();       // §5 — timers + network listeners
  if (isNative()) {
    await KeepAwake.keepAwake();   // line-mounted tablet: screen always on
  }
}
```

**P1b checkpoint:** `npm run android:apk` produces an APK; sideload on the tablet; log in against the plant server over Wi-Fi and submit a coil entry online. Offline comes next.

---

## 4. Phase 2a — SQLite storage layer

WebView IndexedDB can be evicted by Android; SQLite survives everything short of an uninstall. 128 GB storage means retention is a non-issue — keep synced records 30 days for on-device audit before pruning.

### 4.1 `packages/client/src/operator/db/sqlite.ts` (NEW)

```ts
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

let db: SQLiteDBConnection | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,            -- idempotency UUID (client-generated)
  aggregate_key TEXT NOT NULL,    -- e.g. shiftlog:<id> — ordering partition
  seq INTEGER NOT NULL,           -- monotonic per aggregate
  url TEXT NOT NULL,
  method TEXT NOT NULL,           -- POST | PATCH
  payload TEXT NOT NULL,          -- JSON
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|inflight|synced|parked
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  synced_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outbox_agg ON outbox (aggregate_key, seq);
CREATE TABLE IF NOT EXISTS master_cache (
  table_name TEXT NOT NULL, row_id TEXT NOT NULL, data TEXT NOT NULL,
  updated_at INTEGER NOT NULL, PRIMARY KEY (table_name, row_id)
);
CREATE TABLE IF NOT EXISTS plan_cache (
  coil_no TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_cache (
  user_code TEXT PRIMARY KEY, pin_verifier TEXT NOT NULL,  -- scrypt hash, §7
  display_name TEXT, role TEXT, line_code TEXT, cached_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export async function initDb(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;      // web dev falls back to idb path
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  db = await sqlite.createConnection('m1operator', false, 'no-encryption', 1, false);
  await db.open();
  await db.execute(SCHEMA);
}

export function getDb(): SQLiteDBConnection {
  if (!db) throw new Error('SQLite not initialised');
  return db;
}
export const hasNativeDb = () => db !== null;
```

### 4.2 Outbox data-access — `packages/client/src/operator/db/outboxRepo.ts` (NEW)

Implement: `enqueue(action)`, `nextBatch()` (pending rows, grouped by `aggregate_key`, ordered by `seq`, skipping any aggregate whose lowest pending row is `parked`), `markSynced(id)`, `markParked(id, error)`, `bumpAttempt(id, error)`, `counts()` → `{ pending, parked }`, `pruneSynced(olderThanDays = 30)`. On web (no native DB), delegate to an idb-keyval implementation with the same interface so `npm run dev:operator` still works in a desktop browser.

---

## 5. Phase 2b — Ordered outbox sync engine

### 5.1 Why the existing `store/syncQueue.ts` is not enough

It is a flat FIFO of raw HTTP calls with no ordering partitions, no backoff, no poison handling, and it is only consumed by `m3/screens/confirm`. M1 capture pages call the API directly. Do NOT extend it; build the engine below and leave M3's queue untouched.

### 5.2 Ordering model

`aggregate_key = "shiftlog:<shiftLogId>"` (fallback `"line:<lineCode>"` before a shift log exists). Within an aggregate, actions replay strictly in `seq` order: open-shift → entries → stoppages → defects → close-shift. Across aggregates, replay is parallel-safe.

Failure semantics per action:

| Result | Handling |
|---|---|
| 2xx, or 409 duplicate-idempotency-key | `markSynced` — 409 means the server already has it |
| Network error / 5xx / timeout | `bumpAttempt`, retry with exponential backoff (30 s → 1 m → 5 m → 15 m cap), aggregate blocks |
| Other 4xx (validation reject) | `markParked` — aggregate HALTS; badge turns red; supervisor resolves (§5.5) |

A parked action never blocks OTHER aggregates and is never retried automatically.

### 5.3 `packages/client/src/operator/sync/engine.ts` (NEW)

```ts
import { Network } from '@capacitor/network';
import { apiFetch } from '../../lib/apiClient';        // reuse existing auth-refresh fetch
import * as outbox from '../db/outboxRepo';
import { pullMasters, pullPlan } from './pull';
import { useSyncStatus } from './syncStatusStore';

const SYNC_INTERVAL_MS = 5 * 60_000;   // "timely sync": every 5 min
let timer: ReturnType<typeof setInterval> | null = null;

export function startSyncEngine() {
  Network.addListener('networkStatusChange', s => { if (s.connected) void syncNow('reconnect'); });
  timer = setInterval(() => void syncNow('interval'), SYNC_INTERVAL_MS);
  void syncNow('boot');
}

export async function syncNow(reason: string): Promise<void> {
  const status = useSyncStatus.getState();
  if (status.isSyncing) return;
  status.set({ isSyncing: true, lastReason: reason });
  try {
    await pushOutbox();
    await pullMasters();     // §6
    await pullPlan();        // §6
    status.set({ lastSuccessAt: Date.now() });
  } finally {
    const counts = await outbox.counts();
    status.set({ isSyncing: false, ...counts });
  }
}

async function pushOutbox() {
  for (const group of await outbox.nextBatch()) {
    for (const action of group) {                      // strict seq order
      try {
        const res = await apiFetch(action.url, {
          method: action.method,
          headers: { 'X-Idempotency-Key': action.id },
          body: action.payload,
        });
        if (res.ok || res.status === 409) { await outbox.markSynced(action.id); continue; }
        if (res.status >= 400 && res.status < 500) { await outbox.markParked(action.id, await res.text()); break; }
        await outbox.bumpAttempt(action.id, `HTTP ${res.status}`); break;
      } catch (e) {
        await outbox.bumpAttempt(action.id, String(e)); break;   // offline again — stop this aggregate
      }
    }
  }
}
```

(Adapt `apiFetch` to whatever `lib/apiClient.ts` actually exports — it wraps `fetch` with token refresh at line ~122. Export a raw-request variant if only typed helpers exist.)

### 5.4 Wiring capture submits — `packages/client/src/operator/sync/submitOrQueue.ts` (NEW)

Single choke-point used by all operator mutations:

```ts
export async function submitOrQueue(opts: {
  url: string; method: 'POST' | 'PATCH'; payload: unknown; aggregateKey: string;
}): Promise<{ queued: boolean }> {
  const id = crypto.randomUUID();
  await outbox.enqueue({ id, ...opts });   // ALWAYS enqueue first (write-ahead)
  void syncNow('submit');                  // push immediately when online
  return { queued: !navigator.onLine };
}
```

Then EDIT every operator mutation call site to route through it. Find them with: `grep -rn "apiClient\.\(post\|patch\)\|apiFetch" src/pages/capture src/pages/sixHi src/store/shiftStore.ts src/store/sixHiStore.ts src/services/machineHandoverService.ts`. For each: replace the direct call with `submitOrQueue`, using the current shift-log id as `aggregateKey`, and change success UX from "server said OK" to "saved locally — sync badge shows the rest" (optimistic). Client-side Zod validation from `@m1/shared-validation` (`rules/m1Forms.ts`) already runs before submit and works fully offline — keep it as the gate before enqueue, so parked 4xx actions become rare.

Gate the rewiring behind `__OPERATOR_BUILD__` ONLY if a call site is shared with excluded web screens; capture/sixHi pages ship in both targets, and web users get the same offline benefit for free.

### 5.5 Sync visibility — `syncStatusStore.ts` + `SyncStatusBadge.tsx` (NEW, `src/operator/sync/`)

Zustand store: `{ isSyncing, pending, parked, lastSuccessAt }`. Badge (mounted in §2.3): grey dot + "synced" when pending=0; amber + "N pending" when queue non-empty; red + "attention" when parked>0. Tapping when parked>0 opens a list of parked actions with the server error text and a supervisor-PIN-gated "discard" (uses existing `supervisorOverride` in `lib/authApi.ts`). This is the anti-"tablet silently stuck with 40 entries" mechanism.

### 5.6 Server-side idempotency — `packages/server` (EDIT)

The client sends `X-Idempotency-Key` on every mutation. Server must dedupe:

1. Migration (M1-owned, `migrations/modules/m1/`): table `txn.idempotency_key (key uuid primary key, response_status int, response_body jsonb, created_at timestamptz default now())`.
2. Middleware `idempotencyMiddleware` mounted in `src/app.ts` in front of the M1 mutation routes (`/shift-logs /stoppages /defects /crew /production /6hi /machines/handover`): if key exists → replay stored response (or plain 409 if body not stored); else run handler and store `(key, status, body)` in the same transaction as the write.
3. Also stamp `server_received_at` server-side on these writes — tablet clocks drift; client `timestamp` is advisory.

---

## 6. Phase 2c — Pull-sync (masters + planned coils)

Downstream data the operator screens need offline: `master.*` reference tables (shift, machine, grade, stoppage_code, defect codes, customer) and the shift's planned coil list. Server-owned; tablet is read-only; server always wins.

### 6.1 Server endpoint (EDIT `packages/server`)

Add `GET /master-data/delta?since=<iso>` and `GET /planned-coils/delta?line=<code>&since=<iso>` to the existing route files (`routes/` for master-data; `PlannedCoilService` for plan). Response: `{ rows: [...], serverTime }`. If `updated_at` columns are missing on master tables, fall back to full-snapshot responses — at master-data scale (hundreds of rows) snapshot-every-5-min is acceptable; note it and move on.

### 6.2 Client — `packages/client/src/operator/sync/pull.ts` (NEW)

`pullMasters()` / `pullPlan()`: read `sync_meta['masters_since']`, call delta endpoint, upsert into `master_cache` / `plan_cache`, store returned `serverTime` as the new cursor. Then EDIT the read paths used by operator screens (master-data lookups for code tiles, planned-coil list for the dashboard — find via `grep -rn "master-data\|planned-coils" src/pages src/store src/lib`) to a cache-first strategy: serve from SQLite immediately, refresh from network when online. Simplest implementation: a `cachedGet(url)` helper in `pull.ts` that operator code uses instead of raw GET.

Cadence: on shift open + the §5.3 5-minute engine tick + on reconnect. A plan changed while the tablet was offline simply appears at next sync (operator sees the updated coil list; no conflict possible).

---

## 7. Phase 2d — Offline PIN login

Constraint: badge+PIN login (M1-03 §3.1) must work when the line Wi-Fi is down at shift start.

1. **Online login (first time per operator per device):** after successful `POST /auth/login`, derive `verifier = scrypt(pin, salt=userCode+deviceId)` client-side (`scrypt-js`, ~2 kB) and upsert into `auth_cache` with role + line binding. Never store the PIN itself.
2. **Offline login:** if the login call fails with a network error AND `auth_cache` has the user: verify PIN against verifier → create a local session `{ userCode, role, offline: true }`. EDIT `lib/authStore.ts` to accept this degraded session; `ProtectedRoute` treats it as authenticated for operator routes only.
3. **Attribution & upgrade:** every queued action's payload already carries the operator identity from the session. On reconnect, the sync engine first performs a real token refresh/login, then pushes the outbox — entries are attributed server-side exactly as if online. Lockout counter (existing PIN lockout behavior) applies to offline attempts too (count failures in `auth_cache`).
4. **Expiry:** offline sessions valid ≤ 14 h (one shift + margin); `auth_cache` entries expire after 30 days without an online login.

---

## 8. Phase 3a — Kiosk lockdown (Lock Task / COSU)

Tablets are company-owned and dedicated → full device-owner kiosk. The worker cannot leave the app: no Home, Recents, status bar, notifications, or power-menu escape.

### 8.1 Android manifest — `android/app/src/main/AndroidManifest.xml` (EDIT)

On `<activity android:name=".MainActivity">` add:

```xml
android:screenOrientation="landscape"
android:showWhenLocked="true"
android:turnScreenOn="true"
android:lockTaskMode="if_whitelisted"
```

Add `<category android:name="android.intent.category.HOME" />` + `DEFAULT` to the intent filter ONLY if you choose launcher-fallback mode (not needed with device owner; skip by default).

### 8.2 `MainActivity.java` — `android/app/src/main/java/com/zedral/m1operator/MainActivity.java` (EDIT)

```java
package com.zedral.m1operator;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
    ComponentName admin = new ComponentName(this, KioskAdminReceiver.class);
    if (dpm.isDeviceOwnerApp(getPackageName())) {
      dpm.setLockTaskPackages(admin, new String[]{ getPackageName() });
      startLockTask();
    }
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {   // immersive: hide nav/status bars
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) getWindow().getDecorView().setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
      | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
      | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }
}
```

New file `KioskAdminReceiver.java` (same package):

```java
package com.zedral.m1operator;
import android.app.admin.DeviceAdminReceiver;
public class KioskAdminReceiver extends DeviceAdminReceiver { }
```

New file `android/app/src/main/res/xml/device_admin.xml`:

```xml
<device-admin xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-policies />
</device-admin>
```

Register the receiver in the manifest:

```xml
<receiver android:name=".KioskAdminReceiver" android:permission="android.permission.BIND_DEVICE_ADMIN" android:exported="true">
  <meta-data android:name="android.app.device_admin" android:resource="@xml/device_admin" />
  <intent-filter><action android:name="android.app.action.DEVICE_ADMIN_ENABLED" /></intent-filter>
</receiver>
```

Maintenance exit: a hidden gesture (5 taps on the context-bar logo) → supervisor PIN (existing `supervisorOverride`) → call `stopLockTask()` via a tiny Capacitor plugin method or the `@capacitor/app` bridge. Without device-owner, `startLockTask()` falls back to screen pinning (user-escapable) — acceptable for bench testing only.

### 8.3 Tablet provisioning (per device, at factory reset)

Option A — no MDM (bench / pilot): factory reset → skip account setup → `adb install app-release.apk` → `adb shell dpm set-device-owner com.zedral.m1operator/.KioskAdminReceiver`. (Fails if any Google account was added — must be right after reset.)

Option B — **recommended at 10–50 tablets: Headwind MDM** (free, self-hosted, fits on-prem posture): stand up Headwind on the plant server, enroll each tablet via the QR at factory-reset welcome screen (6 taps), assign the APK + kiosk-mode policy to the "operator-tablet" device group. Headwind then owns: APK updates pushed remotely, kiosk policy, Wi-Fi config, disabling OS auto-updates during shifts, remote wipe, last-seen monitoring. Device→line binding stays in-app via the existing `DeviceRegistrationService` flow at first launch (`/setup` page).

---

## 9. Phase 3b — Build, release, updates

### 9.1 Signing

Generate once, keep OUT of the repo (CI secret / vault): `keytool -genkeypair -v -keystore zedral-operator.keystore -alias operator -keyalg RSA -keysize 4096 -validity 9125`. Reference from `android/app/build.gradle` signingConfigs via env vars. **Losing this keystore means tablets need manual reinstall — back it up.**

### 9.2 Versioning

`android/app/build.gradle` `versionCode` = CI build number, `versionName` = client package version. The app sends `X-App-Version` header (add in `lib/apiClient.ts`); server logs it so you can see laggard tablets.

### 9.3 Update path

APK (native shell) updates: pushed by Headwind — expected rarely (plugin/kiosk changes). Web-layer updates (form tweaks, validation): ship as normal APK updates initially; adopt a Capacitor live-update mechanism (e.g. Capgo self-hosted) later ONLY if APK cadence becomes painful. Do not build a custom OTA in P1–P3.

### 9.4 CI guard — operator bundle purity

Add a CI step after `build:operator`: fail if `dist-operator` assets contain strings `"/plant"`, `"maint/"`, `"oee/"`, `"m3/"` chunks (simple `grep -rl` over `dist-operator/assets`). Catches accidental re-inclusion of excluded modules (bundle bloat + attack surface).

---

## 10. Acceptance tests (run on the physical tablet)

**P1:** operator routes only (deep-link `/plant` → redirected); login online; submit a coil entry online; APK survives reboot; screen stays on.

**P2 — the offline drill:**
1. Airplane mode ON → badge+PIN login succeeds (previously cached operator).
2. Open shift → capture 3 coils on a 7-process form + 1 stoppage + 1 defect → all saved, badge shows "6 pending".
3. Kill the app from recents (pre-kiosk), relaunch → queue intact (SQLite, not WebView storage).
4. Airplane mode OFF → within seconds badge drains to "synced"; server shows all 6 records once each, in order, correct operator attribution, `server_received_at` stamped.
5. Repeat step 4 after forcing a mid-queue 500 (kill server between entries) → replay resumes without duplicates (idempotency).
6. Submit an entry that violates a server-only rule → action parks, badge red, other lines' aggregates still sync; supervisor PIN discard works.
7. Change a planned coil on the server while tablet offline → after reconnect the dashboard shows the updated plan.

**P3:** Home/Recents/notification-shade/power-menu cannot leave the app; hidden gesture + supervisor PIN exits kiosk; Headwind pushes a versionCode+1 APK and the tablet updates unattended.

---

## Appendix A — New files summary

```
packages/client/
├── operator.html
├── vite.operator.config.ts
├── capacitor.config.ts
├── .env.operator                      # VITE_API_URL=https://<plant-server>
├── android/                           # generated by `cap add android`, committed
└── src/operator/
    ├── main.tsx
    ├── OperatorApp.tsx
    ├── native/init.ts
    ├── db/sqlite.ts
    ├── db/outboxRepo.ts
    └── sync/{engine.ts, pull.ts, submitOrQueue.ts, syncStatusStore.ts, SyncStatusBadge.tsx}

packages/server/src/
├── middleware/idempotencyMiddleware.ts
└── migrations/modules/m1/<next>__idempotency_key.sql
```

## Appendix B — Edited files summary

| File | Edit |
|---|---|
| `packages/client/src/lib/apiClient.ts` | env-driven `API_BASE`; `X-App-Version` header; export raw `apiFetch` |
| `packages/client/src/api/apiClient.ts` | env host prefix |
| `packages/client/src/lib/authStore.ts` | accept offline degraded session (§7) |
| `packages/client/package.json` | scripts (§2.6) + new deps (§3.1) |
| `packages/client/src/vite-env.d.ts` | `__OPERATOR_BUILD__`, `VITE_API_URL` |
| Operator mutation call sites (capture, sixHi, shiftStore, sixHiStore, machineHandoverService) | route through `submitOrQueue` (§5.4) |
| Operator master-data/plan read paths | cache-first via `cachedGet` (§6.2) |
| `packages/server/src/app.ts` | CORS origins; mount `idempotencyMiddleware` |
| Server master-data / planned-coil routes | `/delta` endpoints (§6.1) |
| `android/` manifest + `MainActivity.java` (+2 new native files) | kiosk (§8) |

## Appendix C — Explicit decisions (locked)

1. Base = `zedral_v4-main`; V2.1 is not touched.
2. Capacitor WebView shell; no React Native rewrite; no PWA/TWA for the tablet.
3. SQLite (not IndexedDB) for outbox + caches on device; 30-day on-device retention of synced rows.
4. Conflict model: single-writer-per-line for transactional data (device line binding enforces it); server-wins for masters/plan. No merge engine.
5. Sync cadence: on submit, on reconnect, every 5 minutes.
6. 6HI/CRM operator screens ARE included (they are part of the operator surface in v4's `/:userScope` routes). If pilot scope must shrink, exclude them by removing 5 routes in `OperatorApp.tsx` — nothing else changes.
7. Kiosk = device-owner Lock Task, managed via Headwind MDM at fleet scale.
