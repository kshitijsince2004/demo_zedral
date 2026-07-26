# ZEDRAL — Camera → OCR Actual-Weight Capture (6Hi / 4Hi)
## Implementation Specification (developer handover)

| | |
|---|---|
| **Status** | Ready for implementation |
| **Version** | 1.1 |
| **Scope** | `Actual Weight (Metric Tons)` field — 6Hi Skin-Pass form + 4Hi Rolling form only |
| **Target app** | Operator console — **Android app only** (Capacitor kiosk, offline-first React client) |
| **Approach** | Layer 2 — in-app camera + on-device OCR + auto-fill (deterrent, no image retained) |

> **v1.1 decisions:** no image/thumbnail stored — **hash only**; feature is **Android-app-only**;
> **confidence threshold is per-machine configurable**; capture uses in-webview `getUserMedia`
> (kiosk-safe). This spec is authoritative and supersedes the storage section of `weight-ocr-plan.md`.

---

## 1. Objective
Reduce operator fabrication of the actual production weight, by letting the operator **photograph the
weighing-machine display** instead of free-typing the value. On-device OCR reads the number and
pre-fills the field; the operator confirms it. The photo is **transient** — used only to produce the
number and a hash, then discarded. Only a hash of the captured image is persisted (for reuse
detection).

## 2. Goals / Non-goals
**Goals**
- Camera button beside the Actual Weight field in both target forms.
- On-device OCR converts the display reading into the numeric field value.
- Field is not free-typed: OCR pre-fills → operator confirms → field locks; changes require re-capture.
- Persist a **SHA-256 hash** of each captured image for duplicate/reuse detection.
- Works **offline** and inside **kiosk** mode.

**Non-goals (explicitly out of scope)**
- Storing any image, thumbnail, or full photo — **nothing visual is retained**.
- True tamper-proof prevention (needs direct scale integration — §12).
- Web-operator support — the browser build keeps the plain manual field (§10.7).
- Any other field or process (only `actualWeightMt` in 6Hi/4Hi).

## 3. Positioning / honest limits
Photo + OCR is a **deterrent**, not prevention: the operator still controls what the camera sees. This
is acceptable for now because the scales are **display-only** (no data output).

**What hash-only buys (and doesn't):**
- ✅ **Reuse detection** — same photo submitted twice → same hash → reject. This is the only ongoing
  function of the hash, and it works *without* keeping the image (hashes are compared to each other).
- ❌ **No visual audit** — there is no picture to review in a dispute.
- ❌ **No integrity-vs-image check** — with no stored image, there is nothing to re-hash and verify; a
  hash cannot be reversed into a picture.
- The **OCR-parsed number is the sole record** of what the display showed.

`actualWeightSource` remains an enum so a future authoritative scale read can drop in (§12).

---

## 4. Constraints (must respect)
1. **Offline-first.** OCR model and logic run with no network; the model is **bundled in the APK**,
   never fetched at runtime.
2. **Kiosk lockdown.** `KioskPlugin.java` restricts app switching. Capture is **in-webview
   `getUserMedia`** (no external camera activity) to stay kiosk-safe. Verify on a locked device.
3. **Tablet performance.** Native ML Kit OCR (not WASM) to keep the JS bundle small and OCR fast.
4. **Never block the line.** Any camera/permission/OCR failure falls back to supervisor-gated manual
   entry. No dead-ends.
5. **Windows build hazard.** `.ts` edits can corrupt to UTF-16 and break Vite — save all edited files
   as **UTF-8**.

---

## 5. Architecture overview

```
[Operator taps camera]
        │
        ▼
[In-webview capture]  getUserMedia → <video> → grab frame to <canvas>   (kiosk-safe; no gallery)
        │  frame bytes (in memory)
        ▼
[SHA-256 hash of frame bytes]  ─────────────►  actualWeightPhotoHash   (the ONLY thing persisted)
        │
        ▼
[Preprocess]  crop→grayscale→threshold→upscale
        │
        ▼
[OCR]  ML Kit TextRecognition (on-device, bundled model)
        │  raw text + confidence
        ▼
[Parse]  regex first  \d+(?:\.\d+)?
        │
        ▼
[Review card]  parsed value + confidence   (no image shown/stored — frame discarded after this)
        │  Confirm            Re-capture        Supervisor override
        ▼
[commitDecimalDraft('actualWeightMt', value)]  → existing form/save path
        │  + actualWeightSource, ocrConfidence, ocrRawText, actualWeightPhotoHash
        ▼
PATCH /6hi/orders/:batchNumber/{rolling|skinpass}
        ▼
[Server validation + persist]  txn.crm_rolling / txn.crm_skinpass   (image never leaves the device)
```

The captured frame lives only in memory long enough to hash, OCR, and parse; it is then dropped. No
blob storage, no evidence table, no sync payload beyond a 64-char string.

---

## 6. Component design — `WeightCaptureButton`
New file: `packages/client/src/components/sixHi/WeightCaptureButton.tsx`. One component serves both
forms.

```ts
export interface WeightCaptureResult {
  value: number;       // parsed weight
  rawText: string;     // full OCR text
  confidence: number;  // 0..100
  photoHash: string;   // SHA-256 hex of captured frame bytes (reuse detection)
}

export interface WeightCaptureButtonProps {
  disabled?: boolean;
  minConfidence: number;   // resolved per-machine (§9.1); below → force re-shoot
  onCaptured: (r: WeightCaptureResult) => void;
  onError?: (e: Error) => void;
}
```

Responsibilities: open in-webview camera → grab frame → hash → preprocess → OCR → parse → surface a
review card → emit `WeightCaptureResult` on confirm → **discard the frame**. It does not own form state.

### 6.1 Preprocessing (baseline; tune from Phase 0)
Grayscale; optional binarize threshold (start ~140 LCD / ~90 inverted LED); upscale ×3; deskew if
available. These are the knobs `weight-ocr-prototype.html` exposes — port the winning settings.

### 6.2 Parse
`const m = text.replace(/[^0-9.]/g, ' ').match(/\d+(?:\.\d+)?/); value = m ? Number(m[0]) : undefined;`
Reject if no match or `!Number.isFinite(value)` → failed read → re-shoot.

### 6.3 Hash
`crypto.subtle.digest('SHA-256', frameBytes)` → hex. Hash the raw captured frame **before**
preprocessing so it fingerprints the actual photo.

---

## 7. Form integration (both forms)
Files: `FourHiRollingForm.tsx`, `SharedSkinPassForm.tsx`. The Actual Weight `ZInput` is driven by
`updateDecimalDraft` / `commitDecimalDraft`. Integrate without touching downstream logic:

1. Render `<WeightCaptureButton>` next to the `actualWeightMt` `ZInput` (both `compact` and full
   layouts). Pass `minConfidence` resolved from the order's machine (§9.1).
2. `onCaptured(r)` → `commitDecimalDraft('actualWeightMt', String(r.value))` so combined-run allocation
   (`combinedWeightAllocation.ts`), the shift-summary recompute (the `actualWeightMt`-keyed `useEffect`),
   and validation behave identically to typed input.
3. Store `r` in local form state; include the audit fields in the `onSave*` payload (§8).
4. **Lock:** once a capture is confirmed, set the `ZInput` `readOnly` (reuse existing `locked`/`disabled`
   mechanism). Only **Re-capture** or **Supervisor override** can change it.

### 7.1 Field states
| State | Field | Actions available |
|---|---|---|
| Empty | editable placeholder | Capture |
| Captured (unconfirmed) | shows OCR value + confidence, review card visible | Confirm, Re-capture |
| Confirmed | `readOnly`, value set, `source=ocr` | Re-capture, Supervisor override |
| Manual override | editable, `source=manual` | type value |
| Error / no camera | falls back to manual (override-gated) | Supervisor override → type |

### 7.2 Supervisor override (reuse existing pattern)
`FieldWrapper` already implements a PIN-gated supervisor override via
`authApi.supervisorOverride(pin, label)` (driven by `isWarning` + `error`). Reuse it: when the operator
needs to bypass capture, surface the same override prompt; on success set `source = manual` and unlock
the input. **Do not build a second override mechanism.**

---

## 8. Data model changes (additive, optional)

### 8.1 Shared types — `packages/shared-validation/src/types/sixHi.ts`
Add to **both** `SixHiRollingData` and `SixHiSkinPassData`:
```ts
actualWeightSource?: 'ocr' | 'manual';
actualWeightPhotoHash?: string;  // SHA-256 hex of captured frame (reuse detection) — NO image stored
ocrConfidence?: number;          // 0..100
ocrRawText?: string;
```
All optional → existing payloads/validation unaffected. Save as UTF-8. **No `photoId` / blob reference**
(no image is stored).

### 8.2 DB migration — new columns
Server migration (mirror `1927*_validation_rules_v2.js` style) adding to `txn.crm_rolling` **and**
`txn.crm_skinpass`:
```
actual_weight_source     text     null   -- 'ocr' | 'manual'
actual_weight_photo_hash text     null   -- SHA-256 hex; no image stored
ocr_confidence           numeric  null
ocr_raw_text             text     null
```
No blob storage, no evidence table, no retention job — nothing to store or expire.

### 8.3 Endpoints (existing — extend payloads, no new routes)
- `PATCH /6hi/orders/:batchNumber/rolling`  — body `SixHiRollingData` (+ new fields)
- `PATCH /6hi/orders/:batchNumber/skinpass` — body `SixHiSkinPassData` (+ new fields)
- `GET /6hi/orders/:batchNumber` — returns the new fields for read-back / lock restore.

Client call site unchanged: `SixHiWorkspaceModal.patchCombinedProduction()` →
`apiClient.patch('/6hi/orders/{batch}/{rolling|skinpass}', payload)`.

---

## 9. Hash-only persistence & per-machine confidence

### 9.1 Per-machine confidence threshold (configurable)
The minimum OCR confidence to auto-accept is **configured per machine** (keyed by the order's
`machineCode`; both forms have it on `SixHiOrderDetail`). Recommended implementation:
- Add a machine-config value `ocr_min_confidence` (e.g. to the machine master / a
  `machine_ocr_config` table), server-provided.
- `GET /6hi/orders/:batch` (or a small config endpoint) returns the resolved threshold for that order's
  machine; client passes it to `WeightCaptureButton.minConfidence`.
- Fallback default (e.g. `60`) when no per-machine value is set.
- Below threshold → force re-shoot (no auto-accept).

### 9.2 Hash usage
- Compute SHA-256 of the raw captured frame; persist as `actualWeightPhotoHash`.
- **Reuse detection:** on save, reject a capture whose hash matches any existing production row's hash
  (catches re-submitting the same photo). This is the hash's sole runtime purpose.
- No image, thumbnail, or full-res is stored anywhere.

---

## 10. Native / Capacitor setup
1. **Capture:** in-webview `getUserMedia({ video: { facingMode: 'environment' } })` → `<video>` → draw a
   frame to `<canvas>`. Kiosk-safe (no external activity), no gallery access. Add `CAMERA` permission
   to `AndroidManifest.xml`; request at runtime; denial → manual fallback.
2. **OCR:** `@capacitor-mlkit/text-recognition` — write the captured frame to a temp file (or pass per
   the plugin API) and call `TextRecognition.processImage`. On-device, bundled model.
3. **Offline:** confirm ML Kit uses the bundled model with no network (airplane-mode test).
4. **Kiosk:** verify `getUserMedia` works under `KioskPlugin` lockdown on a real locked device (Phase 1
   gate).
5. **Cleanup:** delete any temp frame file immediately after OCR + hashing.
6. **`@capacitor/camera` not required** if `getUserMedia` capture is used; if the team prefers it as a
   fallback, force `source: CameraSource.Camera`, `saveToGallery: false`.
7. **Web build (app-only decision):** the browser operator build (`vite.operator.config.ts` /
   `dist-operator`) does **not** show the camera button — the Actual Weight field stays the normal manual
   input there. Gate the feature behind a native-capability check; no `getUserMedia`/Tesseract web path
   is built.

---

## 11. Server validation
Extend `packages/server/src/validation/crm6ProductionValidation.ts` (+ `shared-validation` rules):
- Accept and persist the new optional fields.
- If `actualWeightSource === 'ocr'`, require `actualWeightPhotoHash` present.
- Reject a capture whose `actualWeightPhotoHash` duplicates an existing production row (reuse detection).
- Keep the existing tolerance check `assertQuantityWithinProduction(actualWeightMt, plannedMt, …)`
  unchanged — it already compares actual vs PPC planned weight and is the cheapest anti-fabrication
  lever. (Optional follow-up: widen to mass-balance reconciliation — §12.)

---

## 12. Future-proofing & recommended companion
- **Weight-source seam:** `actualWeightSource` is an enum on purpose. When a data-capable indicator is
  installed, add `'indicator' | 'plc'` and make it authoritative; capture demotes to a fallback. No form
  rework.
- **Reconciliation (companion, cheap, high value):** the real anti-fabrication lever on display-only
  hardware. Extend `assertQuantityWithinProduction` toward mass balance (input coil weight − scrap ≈
  output, within tolerance) and flag outliers for supervisor approval. Independent of this feature;
  recommended next. (See open question §17.)

---

## 13. Acceptance criteria
1. Camera button appears beside Actual Weight in **both** forms, glove-mode sized, compact + full
   layouts — **in the Android app only** (absent in the web build).
2. Tapping it opens in-webview capture (no gallery), works under kiosk lockdown on a real device.
3. A clear display photo pre-fills the numeric value; confidence below the **machine's** threshold forces
   a re-shoot.
4. After **Confirm**, the field is `readOnly`; value flows through `commitDecimalDraft` and saves via the
   existing PATCH endpoints; combined-run totals and shift summary update correctly.
5. **Re-capture** replaces value + hash; **Supervisor override** (existing PIN flow) unlocks manual entry
   and records `source = manual`.
6. A confirmed capture stores `source='ocr'`, `actualWeightPhotoHash`, `ocrConfidence`, `ocrRawText` —
   and **no image**.
7. Re-submitting a previously used photo (same hash) is rejected.
8. Camera denied / OCR failure → graceful manual fallback; the line is never blocked.
9. Full flow works **offline** (airplane mode).
10. Reading back a saved order restores the locked state + stored value/source (no image to show).
11. The captured frame + any temp file are discarded immediately after OCR + hashing.

---

## 14. Test plan
- **Unit:** number parser (decimals, leading zeros, junk chars, empty, multiple numbers); SHA-256 hash;
  per-machine threshold resolution + default fallback.
- **Component:** capture→confirm→lock; re-capture; override→manual; below-threshold re-shoot;
  camera-denied fallback. Both forms, both layouts.
- **Integration/server:** PATCH accepts new fields; duplicate-hash rejection; `source=ocr` requires hash;
  existing tolerance check still fires; per-machine threshold delivered to client.
- **Device QA (real tablet, kiosk):** glove mode; glare; dim light; dirty/angled display; airplane mode;
  permission denial; confirm no image persists. Record OCR accuracy on ≥20 real displays.

---

## 15. Task breakdown (suggested milestones)
| # | Task | Output |
|---|---|---|
| 0 | **Phase 0 accuracy spike** — run `weight-ocr-prototype.html` on ≥20 real display photos | Go/no-go on ML Kit vs 7-seg model; locked preprocess settings |
| 1 | Native plumbing — in-webview `getUserMedia` capture + `@capacitor-mlkit/text-recognition`, `CAMERA` permission, bundled model; verify under kiosk | Camera + OCR on-device, offline, kiosk-safe |
| 2 | `WeightCaptureButton` (capture→hash→preprocess→OCR→parse→review→discard frame) | Reusable component + `WeightCaptureResult` |
| 3 | Wire into `FourHiRollingForm` + `SharedSkinPassForm`; confirm/re-capture/lock; reuse supervisor override; app-only gate | Feature functional in both forms (Android) |
| 4 | Contracts + migration + per-machine threshold config + server validation + hash dedup | New fields persisted/validated; hash-only |
| 5 | Tests + device QA | Green suites + signed-off device QA |

---

## 16. Risks
| Risk | Mitigation |
|---|---|
| Seven-segment OCR accuracy | Phase 0 spike before build; fall back to 7-seg-tuned model |
| `getUserMedia` blocked/unstable under kiosk | Verify Phase 1 on a locked device; `@capacitor/camera` as fallback |
| No visual evidence (hash-only) | Accepted decision; pair with reconciliation (§12); plan scale integration |
| Operator photographs a fake display | Accepted limit of Layer 2; reconciliation catches impossible values |
| APK/model size growth | Native ML Kit (in-APK model); no image storage keeps everything else tiny |
| Windows UTF-16 `.ts` corruption | Save edited files UTF-8; verify Vite build |

## 17. Open questions for the team
1. Where should per-machine `ocr_min_confidence` live — machine master column vs a dedicated config
   table — and who maintains it?
2. Should reconciliation / mass-balance (§12) be bundled into this effort or tracked separately?
3. Confirm the hash algorithm/encoding (SHA-256 hex) and whether reuse-detection should scope to a time
   window (e.g. same shift) or be global.

## 18. Resolved decisions (v1.1)
- **Evidence:** hash only — no image/thumbnail/full-res stored anywhere.
- **Platform:** Android app only; web build keeps the plain manual field.
- **Confidence threshold:** per-machine configurable, with a default fallback.
- **Capture:** in-webview `getUserMedia` (kiosk-safe), pending device verification in Phase 1.
```
