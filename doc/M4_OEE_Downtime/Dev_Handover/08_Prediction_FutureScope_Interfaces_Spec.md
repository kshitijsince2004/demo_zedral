# M4 · 08 · Prediction / ML — Future-Scope Interfaces
**Deep-plan:** §8 · **Build phase:** M4-5 (GATED on data + D9) · **No v1 build**

## 1. Stance
Mirrors M2 (predictive) and M3 (optimisation): **future-proof now, build later, gated on accumulated history.** v1 ships the data substrate and interface stubs only. No prediction is promised in v1 — only prediction *readiness*.

## 2. Capabilities (when built)
| Capability | Input substrate (built in v1) | Output |
|---|---|---|
| Breakdown / micro-stop risk | labelled `state_interval` + reason codes | probability per asset/window → M2 PdM |
| Speed-loss degradation forecast | calibrated ideal-cycle + Performance series | predicted slow-creep before it costs a shift |
| Quality-loss window prediction | startup/transition `loss_attribution` | likely L6 windows (grade change, run-up) |
| Prescriptive | all of the above + cost | "act now to protect Availability" (2–3 yr) |

## 3. Shared substrate with M2
M4 loss prediction and M2 predictive maintenance converge on the **same `DowntimeEvent` stream + OSA-CBM pipeline**. The breakdown-risk model is a **shared platform asset**, not a duplicate — M4 contributes the OEE-loss labels, M2 the condition/failure features. Build coordinates with M2 spec 08.

## 4. Readiness gate (the only v1 deliverable here)
`oee.readiness_snapshot` carries a **HISTORY** gate per asset: enough labelled loss history (threshold = open decision; shared with M2's PdM gate) flips `prediction_enabled` eligibility. Until then the UI shows "prediction-ready: not yet — N weeks of labelled loss history needed," never a fake forecast.

## 5. Stub
`oee.loss_prediction` exists, empty, unwritten in v1. Populated only when models are built and the HISTORY gate passes.

## 6. Acceptance (MUST)
- F-01 No v1 code path writes `oee.loss_prediction`.
- F-02 The HISTORY gate computes and displays per-asset readiness honestly.
- F-03 Interfaces are documented so the model build is a switch-on, not a re-model.
