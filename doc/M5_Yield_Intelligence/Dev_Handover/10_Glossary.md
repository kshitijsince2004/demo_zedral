# M5 · 10 · Glossary
**Yield & loss terms used across the M5 specs.**

| Term | Meaning |
|---|---|
| **Material / mass yield** | Good output mass ÷ input mass (kg/MT). The metals-native yield. |
| **Metallic / prime / mill yield** | Industry names for material yield of sellable ("prime") product. |
| **First-Pass Yield (FPY)** | Good units right first time ÷ units started (no rework), at a step. |
| **Throughput Yield (TPY)** | Good ÷ processed at a single step. |
| **Rolled-Throughput Yield (RTY)** | ∏ FPYᵢ across all steps — probability a unit clears the whole chain clean. |
| **Quality Ratio** | ISO 22400 GQ ÷ PQ — reconciles to M4's OEE Quality factor. |
| **Scrap Ratio / Rework Ratio** | ISO 22400 SQ ÷ PQ / RQ ÷ PQ. |
| **Mass balance** | Input = Good + Scrap + Rework + By-product + ΔWIP + Gap (conservation of mass). |
| **Reconciliation gap** | \|Input − accounted Output\| ÷ Input. Data-trust meter; >tolerance ⇒ data deviation, not yield loss. |
| **GQ / SQ / PSQ / RQ / PQ / IQ / BP** | ISO 22400 quantities: Good / Scrap / Planned-Scrap / Rework / Produced / Input / By-product. |
| **Planned scrap (PSQ)** | Yield loss designed into the process (standard crop, trim, sampling) — reported but not an "opportunity." |
| **Avoidable loss** | Actual loss − PSQ — the recoverable target. |
| **Recoverability** | PURE_LOSS (gone, e.g. scale) / SALVAGE (sold as scrap) / RECOVERABLE (reworked at added cost). |
| **Hits-twice** | A lost tonne loses the sale *and* the sunk conversion cost; recovered tonne's marginal cost ≈ 0. |
| **Loss bridge / waterfall** | Input → −crop → −scale → −trim → −transition → −cobble → −off-gauge → −rework → Good. |
| **Genealogy (COIL_NO)** | Parent→child lineage with weight at each step; the spine for attribution + RTY. |
| **Crop loss** | Head/tail material removed (often largest steel yield loss; batch-size sensitive). |
| **Scale / oxidation loss** | Metal lost to oxide in reheat/anneal (pure loss; furnace-atmosphere sensitive). |
| **Trim loss** | Edge/side material trimmed to width; slit scrap. |
| **Transition loss** | Off-spec produced during a grade/temper change on continuous lines (ties to M3 sequencing). |
| **Cobble** | Bar/strip tangles/jams; scraps the piece plus up/downstream (event-linked to M4 downtime). |
| **Six Big Losses L5 / L6** | TPM Quality losses: L5 process defects, L6 startup/yield — the M4↔M5 handoff. |
| **Dual basis** | Yield computed in mass *and* count at parity; each catches what the other hides. |
| **Capture fidelity** | MANUAL (M1) / INGESTED / AUTOMATIC (weighing/length/vision) — drives confidence. |
| **No-double-count anchor** | Every loss row carries the canonical `production_count_id` of the shared count. |
| **Fidelity / History gate** | Readiness sub-gates: confidence of the yield number / prediction-readiness. |
