# M5 · 08 · Prediction / ML — Future-Scope Interfaces Spec
**Deep-plan:** §8 · **Decision:** D9 (rules now / ML later) · **Status:** interfaces only — NO v1 build

## 1. Principle
v1 is descriptive/diagnostic. The mass-balance + loss-attribution + cost substrate **is** the training data for later prediction. We ship the **hooks and the readiness gate** now; the model build is gated on accumulated, labelled yield history. No prediction *promises* in v1 — only prediction *readiness*.

## 2. Future capabilities (gated)
| Capability | v1 (now) | Future (gated) |
|---|---|---|
| Yield level | compute/attribute/bridge/price | **yield forecast** per route×grade from history + process params |
| Input sizing | static expected-yield factors | **optimal-input-sizing / design-to-yield** — recommend charge/coil size & crop to hit target output |
| Transition loss | measure & price | **predicted transition windows** → optimal grade sequencing (feeds M3) |
| Supplier/material | yield-by-lot spread (diagnostic) | **incoming-yield prediction** from lot certificates (thickness/composition) → sort/contain pre-process |
| Decision support | bridge + alerts | **prescriptive** "change sizing/sequence/spec now" (2–3 yr) |

## 3. What v1 must get right (so it's a switch-on, not a rebuild)
1. **Closed, reconciled mass balances + labelled loss reasons** from day one (the labels).
2. **Calibrated expected-yield factors** (so avoidable-loss series are signal, not noise).
3. **Loss attribution joined to genealogy, grade, supplier-lot and cost** (features + objective).
4. **History gate** in `readiness_snapshot` reporting per route×grade when enough labelled history exists.

## 4. Stub interface
`yield.yield_prediction` table exists (unwritten in v1): `predicted_yield_pct`, `predicted_loss_cost`, `model_version`, `confidence_pct`, horizon. Read API `GET /v1/yield/prediction?...` returns `501 Not Implemented` until the History gate passes and a model is registered.

## 5. Shared ML-readiness substrate
M5's yield/transition prediction shares the platform ML-readiness gate with **M4** (loss), **M2** (PdM) and **M6** (defect): a grade-transition that predicts a yield-loss window (M5) and a quality-defect risk (M6) is **one shared model surface**, not three duplicates. Build M5 prediction only when the shared History gate is green for the target route×grade.
