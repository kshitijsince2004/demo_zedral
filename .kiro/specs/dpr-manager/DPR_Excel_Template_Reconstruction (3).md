# DPR Excel Template — Complete Reconstruction Specification

**Source:** `DPR March 2026.xlsx`
**Purpose:** A full, literal description of the workbook — geometry, colors, fonts, borders, merged cells, column widths, row heights, number formats, formulas, and both sheets — so the **master template can be rebuilt programmatically and exactly** (then used with template-injection for daily data). Every value below was read directly from the file.

> Build target for Kiro: reproduce this workbook cell-for-cell. After building, a zero-data export must be visually indistinguishable from the original master (same colors, fonts, merges, spacing, borders, formulas) with only the numbers cleared.

---

## 1. Workbook overview

- **Two worksheets**, in this order: **`MARCH26`** (main DPR) and **`DELAY`** (stoppage log).
- The sheet **tab name encodes the month** (`MARCH26` = `<MONTHNAME><YY>`). This is the only month token besides the date strings and filename.
- `MARCH26` is a vertical stack of **31 identical day-blocks**, each **46 rows tall**.
- `DELAY` is a vertical stack of **93 shift-blocks** (31 days × 3 shifts), each ~20 rows.
- Gridlines: shown (default). Freeze panes: none.

### 1.1 Theme color scheme (workbook theme1.xml — needed because most fills are theme/indexed colors)

| Slot | Hex | Slot | Hex |
|---|---|---|---|
| dk1 (text1) | `000000` | accent1 | `5B9BD5` |
| lt1 (bg1) | `FFFFFF` | accent2 | `ED7D31` |
| dk2 (text2) | `44546A` | accent3 | `A5A5A5` |
| lt2 (bg2) | `E7E6E6` | accent4 | `FFC000` |
| | | accent5 | `4472C4` |
| | | accent6 | `70AD47` |

For reconstruction you don't need theme indirection — **use the resolved RGB hex values given throughout this document directly.**

### 1.2 Global sheet format

| Setting | `MARCH26` | `DELAY` |
|---|---|---|
| Default column width | `10.28` | (Excel default) |
| Default row height | `15.0` | `15.0` |
| Max columns used | 106 (A→DB) | 7 (A→G) |
| Max rows | 1424 | 1861 |

---

## 2. Color legend (semantic — drives the whole look)

All fills resolved to RGB. The coloring is **static** (no conditional formatting anywhere). Meaning of each fill:

| Fill RGB | Swatch name | Where it's used / meaning |
|---|---|---|
| `FFFFFF` | White | All header/title cells and unfilled body (explicit white fill on the header band). |
| `FFFF99` | Light yellow | **Primary daily-INPUT cells** — production A/B/C (`C,D,E`), stoppage-detail A/B/C (`Z,AA,AB`,`AD,AE,AF`,`AH,AI,AJ`), shift scrap/rej/trim inputs (`BJ,BN,BR`…), W/R-change `K..P`. This is the "type here" color. |
| `00FFFF` | Cyan | **Equipment-availability INPUT cells** (`AL,AM,AN`) on rolling-machine rows only. |
| `FFCC99` | Peach | **Computed / derived band** — totals, cumulative, utilisation, prod-rate, the whole right stoppage matrix (cols `Y`→`BG`) and `G,H,I–P` formula cells. Visually groups "system-calculated" fields. |
| `CCFFFF` | Pale cyan | Target column `B` cells and the SCRAP %/REJ % computed cells (`CL..CU`). |
| `C0C0C0` | Silver | Scrap/Rej/B.slit **shift sub-headers** in the right block (the non-input boxes between input cells, cols `BI..BT`). |
| `FFFF00` | Yellow | A few attention cells: `O.T` label `A31`, sum highlights `S36:U37`, `O37`, and the entire **`DELAY` header row**. |
| `F4B183` | Light orange | The `O.T` (overtime) input cells `B31:E31`. |
| `FFC000` | Gold | `O.T` total cells `F31,G31`. |

---

## 3. `MARCH26` — day-block geometry & addressing

```
Block height           = 46 rows
Day 1 title row        = 2
Day N title row (N>=2) = 49 + (N-2)*46     -> day2=49, day3=95, ... day31=1383
absoluteRow(N, offset) = titleRow(N) + offset
```

Row 1 is a single blank spacer at the very top. Every cell inside a block is referenced by **offset from its title row**. The tables below describe **one block** (offsets); replicate it for all days, changing only the date string (col `M`), the day number (col `BH`, = N), and the cumulative back-references in formulas.

### 3.1 Row-height pattern (within a block, by offset)

| Offset(s) | Height |
|---|---|
| 0 (title) | `23.2` |
| 1 | `15.8` |
| 2 | `31.5` |
| 3–34 | `15.8` |
| 35–36 | `15.0` |
| 37–39 | `15.8` |
| 40–45 | `15.0` |

(Day 1: these map to absolute rows 2,3,4,5…; height is set per the offset above.)

### 3.2 Column widths (`MARCH26`, full A→DB; “def” = default 10.28)

```
A 8.71 | B def | C def | D def | E def | F 10.57 | G 11.14 | H 8.86 | I 11.43 | J 7.29
K def | L 8.71 | M 7.29 | N 9.29 | O 7.29 | P 8.57 | Q 7.29 | R def | S def | T def | U def | V def
W 10.29 | X 3.29 | Y 10.57 | Z 6.71 | AA 6.71 | AB def | AC 7.71 | AD 6.71 | AE def | AF def
AG 7.86 | AH 6.71 | AI def | AJ def | AK 7.71 | AL 6.71 | AM def | AN def | AO 7.71 | AP 6.71
AQ def | AR def | AS def | AT def | AU 10.29 | AV 8.14 | AW 6.71 | AX–BG def
BH 10.71 | BI–BO def | BP 10.14 | BQ–BS def | BT 10.29 | BU–BV def | BW 10.14 | BX 10.29
BY–CF def | CG 11.71 | CH 10.29 | CI def | CJ 9.71 | CK 11.0 | CL 10.29 | CM–DB def
```

---

## 4. Block anatomy — region by region (one block; styles are literal)

Fonts: the workbook mixes **Book Antiqua** (title row only), **Arial** (entire body), and **Calibri** (DELAY entries). Default body text is **Arial**; sizes vary by region (8–18 pt). Bold (`B`) noted per region. All text is **center**-aligned unless stated.

### 4.1 Offset 0 — TITLE ROW (height 23.2, fill `FFFFFF`, medium box borders)

| Cell(s) | Content | Font | Notes |
|---|---|---|---|
| `A` | `DAILY REPORT-PRODUCTION/STOPPAGE` (lead/trail spaces, centered) | Book Antiqua 12 B | medium border all sides |
| `B–G` | (blank banner continuation) | Book Antiqua 18 B | medium |
| `K:L` (merged) | `DATE` | Book Antiqua 14 B | medium |
| `M:N` (merged) | date string `01.03.2026` | Book Antiqua 14 B | number-format `mm/dd/yy`, stored as **text** |
| `BH` | day number `1` | Arial 12 B | medium left |
| `BI:BL` / `BM:BP` / `BQ:BT` (merged) | `SHIFT A` / `SHIFT B` / `SHIFT C` | Arial 12 B | medium box; nf `0.000` |
| `BY` | `TODAY'S CUMMALITIVE FIGURES` | Arial 12 B | |
| `CF` | `TILL DATE CUMMALITIVE FIGURES` | Arial 12 B | |
| `CL:CN` (merged) | `SCRAP` | Arial 12 B | medium box |
| `CR:CT` (merged) | `INTERNAL REJ.` | Arial 12 B | medium box |

### 4.2 Offsets 1–3 — COLUMN HEADER BAND (Arial, bold, thin borders, white fill)

**Offset 1** (left side): `A`=`AREA` (Arial 8 B); `B:H`(merged)=`PRODUCTION`; `I:N`(merged)=`STOPPAGE`; `O3:P4`(merged)=`Utilisation %.` (wrap); `Q3:V4`(merged)=`PROD. RATE`; `Y3:AU3`(merged)=`STOPPAGE`. Right side: `BH`=`AREA`, `BI`=`SCRAP`, `BK`=`REJ`, `BL`=`B.SLIT`, repeated for B/C shifts (`BM/BO/BP`, `BQ/BS/BT`); `BW`=`AREA`,`BX`=`SCRAP`,`BY3:BY4`=`TOTAL`,`BZ`=`REJ`,`CA`=`B.SLIT`; `CD/CE/CF/CG/CH` same for till-date; `CK`=`AREA`,`CL/CM/CN/CO`=`A/B/C/Total` (SCRAP%); `CQ..CU` same (INTERNAL REJ %).

**Offset 2** (sub-headers, Arial 12 B): `C/D/E`=`A/B/C`, `F`=`TOTAL`, `G`=`CUM`, `H`=`AVG.`, `I`=`ELECT`,`K`=`MECH`,`M`=`OPRN` (each merged over 2 cols with TDY/CUM beneath). Right stoppage matrix headers: `Z4:AC4`(merged)=`ELECTRICAL`, `AD4:AG4`=`MECHANICAL`, `AH4:AK4`=`OPERATINAL`, `AL4:AO4`=`EQUIP. AVAILABILITY.`, `AP4:AQ4`=`PREV. MAINT`, `AR4:AU4`=`POWER FAILURE`, `AW4:BA4`=`NO PLAN`, `BB4:BF4`=`R/M SHORTAGE`. These header cells are fill `FFCC99` (peach) at offset 2.

**Offset 3** (Arial 12 B): `B`=`TGT`; `C..H`=`Prodn` (×6); `I/K/M/O`=`TDY`, `J/L/N/P`=`CUM`; `Q/R/S`=`A/B/C`, `T`=`TDY`,`U`=`CUM`,`V`=`TGT`; stoppage matrix sub-cols `Z/AA/AB`=`A/B/C`,`AC`=`TOTAL` (repeated for each group); `AL/AM/AN`=`A/B/C`,`AO`=`CUM`; `AP`=`TDY`,`AQ`=`CUM`; `AR/AS/AT`=`A/B/C`,`AU`=`CUM`; etc.

### 4.3 Offsets 4–29 — MACHINE / AREA DATA ROWS

26 rows, one per area. Column-A label by offset:

```
4 HRS · 5 PKLG · 6 4 Hi(R) · 7 4 Hi(RR) · 8 4 Hi(SP) · 9 6 Hi (R) · 10 6 Hi (RR)
11 6HI SP · 12 2 Hi (SP) · 13 2HIR/W · 14 R/W LINE · 15 HPH · 16 CRS-1 · 17 CRS-2
18 CRS-3 · 19 CRS-4 · 20 CRS-5 · 21 CRS-6 · 22 CTL-1 · 23 CTL-2 · 24 CTL-3
25 CTL-4 · 26 CTL-5 · 27 PKG · 28 WIP · 29 O.T
```

**Per-cell style on a machine row (Arial, thin `TBLR` borders, center):**

| Cols | Fill | Bold | Role |
|---|---|---|---|
| `A` (label) | `FFCC99` | yes (8 pt) | area name |
| `B` (target) | `CCFFFF` | yes (12) | monthly TGT (config) |
| `C,D,E` | `FFFF99` | yes (12) | **production input** (nf `0.0`) |
| `F` | white | yes | `=C+D+E` |
| `G,H` | `FFCC99` | yes | cumulative / average |
| `I–P` | `FFCC99` | no (10) | stoppage TDY/CUM, utilisation (formulas) |
| `Q–V` | `FFCC99` | no | prod-rate (formulas) + `V` target |
| `X` | white | no | day-divisor (`=BH2` / chain) |
| `Z,AA,AB` | `FFFF99` | yes (10) | **electrical input** |
| `AC` | `FFCC99` | no | `=Z+AA+AB` |
| `AD,AE,AF` | `FFFF99` | yes | **mechanical input** |
| `AG` | `FFCC99` | no | `=AD+AE+AF` |
| `AH,AI,AJ` | `FFFF99` | yes | **operational input** (right-aligned) |
| `AK` | `FFCC99` | no | `=AH+AI+AJ` |
| `AL,AM,AN` | `00FFFF` (cyan) on rolling rows; else `FFCC99` | no | **availability input** |
| `AO` | `FFCC99` | no | availability CUM |
| `AP` | `FFCC99` | no | prev-maint |
| `AQ` | `FFCC99` | no | `=AP` (+prev day) |
| `AR,AS,AT` | `FFCC99` | no | power-failure (hold input values) |
| `AU` | `FFCC99` | no | `=AR+AS+AT` |
| `AV–BG` | `FFCC99` | no | NO PLAN / R-M SHORTAGE / block-sum |
| `BH` (right AREA) | white | yes (12) | right-block label, medium left border |
| `BI,BK,BL` etc. | `C0C0C0` | varies | scrap/rej/b.slit sub-boxes |
| `BJ,BN,BR` | `FFFF99` | yes (10) | **scrap input** (nf `0.000`) |
| `BW–CA`,`CD–CH` | white | yes | today's/till-date cumulative (formulas) |
| `CL–CU` | `CCFFFF` | no | scrap %/rej % (formulas) |

> **Right-block AREA grouping (cols BH/BW/CK):** the right side lists a *condensed* machine set on these offsets: `HRS`(6), `4HIM`(8), `6HIM`(10), `2HIM`(12), `R/W LINE`(14), `CRS-1`(16), `CRS-2`(17), `CRS-3`(19), `CRS-4`(21), `CRS-5`(23), `CRS-6`(24/25), `CTL1`(25), `CTL2`(27), `CTL3`(29), `CTL4`(31), `CTL5`(33), `SUM`(35). (Note the right side spans a couple offsets past the left machine list, into the summary band.)

### 4.4 Offsets 30–41 — SUMMARY / TARGET / SCRAP / YIELD BAND

| Offset | Col-A label | Contents (left→right highlights) |
|---|---|---|
| 30 | `WIP` | `E`=`DESP`, `F`=despatch input (`FFFF99`), `G`=`=F30`, `H`=`=G30/BH`; `K30..V30` headers `A/B/C/TODAY/CUMM/AVERAGE` |
| 31 | `O.T` (fill `FFFF00`) | `B31:E31` overtime inputs (fill `F4B183`), `F31/G31` totals (fill `FFC000`); `K31..V31` = `NOS./TIME` ×6 |
| 32 | `SCR %` | `C32..H32` labels `HRS/4HIM/6HIM/2HIM/R/W LINE/R/M`; `I32:J32`=`W/R CHANGE 4Hi`; `K32..P32` inputs (`FFFF99`); `Q32..V32` formulas |
| 33 | `TGT %` | `C33..G33` target % constants `1.2,0.85,1.15,0.85,0.85`; `H33`=`=F6`; `I33`=`W/R CHANGE 6Hi`; `K33..P33` inputs; `Q..V` formulas |
| 34 | `SCR %` `B`=`TDY` | `C34..G34` = scrap-% TDY formulas `=BY6/F6%`, `=BY8/(F8+F9+F10)%`, …; `I34`=`W/R CHANGE 2Hi`; `K34..P34` inputs |
| 35 | (blank A) `B`=`CUM` | `C35..G35` = scrap-% CUM formulas `=CF6/G6%`, …; `M35:O35`=`CARBON SOOT`; right `BH35/BW35`=`SUM` rows with big SUM formulas |
| 36 | | `H36`=`TTL`; `P36`=`Tdy`; `V36`=`=Q36+..+U36`; `%AGE` sum row on right |
| 37 | `SCR %` | `C37..I37` = `CRS1..CRS-5` labels; `M37:N37`=`Op.Bal`; `Q37..V37`=`=Q36`… |
| 38 | | `C38..I38` target % constants `1.5,1.45,1.25,1.5,1.5,1.5`; `K38`=`R/W LINE`; `M38:N38`=`T.Hold`; `Y38`=`YIELD`,`Z38` yield formula |
| 39 | `TRIM` `B`=`TDY` | `C39..K39` = trim % formulas; `M39`=`Cleaned`; `T39:T41`=`SCR`; `U39`=`TGT`; `V39`=`5.25` (yield tgt); `Y39:Z39`=`Rej. Sale` |
| 40 | `B`=`CUM` | `C40..K40` = trim % CUM formulas; `M40`=`Cl. bal`; `U40`=`TDY`,`V40` formula; `Y40`=`MT`,`Z40`=`0` |
| 41 | | `C41,D41,E41` trim target constants `1.95,1.75,1.65`; `G41..S41` rej-% machine labels; `U41`=`CUM`,`V41` formula; `Y41`=`CUM%`,`Z41` formula |
| 42 | `TTL` `B`=`TDY` | rej/total % rows (`C42..V42` formulas) |
| 43 | `B`=`CUM` | rej/total % CUM (`C43..V43` formulas) |
| 45 | `MAJOR STOPPAGES:-` | free-text note line |

---

## 5. Complete merged-cell ranges (one block, offsets shown as day-1 absolute rows)

```
Title:  K2:L2, M2:N2, BI2:BL2, BM2:BP2, BQ2:BT2, CL2:CN2, CR2:CT2
Hdr1:   B3:H3, I3:N3, O3:P4, Q3:V4, Y3:AU3, BW3:BW4, BY3:BY4, BZ3:BZ4, CA3:CA4,
        CD3:CD4, CF3:CF4, CG3:CG4, CH3:CH4
Hdr2:   I4:J4, K4:L4, M4:N4, Z4:AC4, AD4:AG4, AH4:AK4, AL4:AO4, AP4:AQ4, AR4:AU4,
        AW4:BA4, BB4:BF4
Body:   B8:B9, Q8:Q9, R8:R9, S8:S9, T8:T9, U8:U9, V8:V9,
        B11:B12, Q11:Q12, R11:R12, S11:S12, T11:T12, U11:U12, V11:V12,
        Q14:Q15, R14:R15, S14:S15, T14:T15, U14:U15, V14:V15
Summary:B30:C30, O30:P30, Q30:R30, S30:T30, U30:V30, A32:B32, A34:A35, A37:B37,
        CB33:CC33, M35:O35, M37:N37, M38:N38, M39:N39, M40:N40, U38:V38,
        T39:T41, T42:T43, Y39:Z39,
        BI35:BI36, BL35:BM36, BP35:BQ36, BT35:BT36
```
(73 merges per block. The `B8:B9`, `Q8:Q9…V8:V9`, `B11:B12…`, `Q14:Q15…` groups merge the target/prod-rate cells across the paired sub-rows of the 4Hi, 6Hi and 2Hi machine groups.)

---

## 6. Number-format legend

| Format string | Applied to |
|---|---|
| `0.0` | production cells `C,D,E,F,G,H` |
| `0` | stoppage integer cells (`I,K,M`, `AC,AG,AK`, `Z..BF`, `AH..AJ`) |
| `0.00` | electrical totals, prod-rate, scrap-% precision cells |
| `0.000` | shift scrap/rej inputs (`BI..BT`), `SHIFT A/B/C` headers, `O.T` cells |
| `mm/dd/yy` | date cell `M` (value held as the text string `dd.mm.yyyy`) |
| `General` | text labels |

---

## 7. Formula catalog (templated by machine row `r`; cells hold these as-is)

```
Production total   F{r} = =C{r}+D{r}+E{r}
Cumulative (day1)  G{r} = =F{r}
Cumulative (dayN)  G{r} = =F{r}+G{r@prevDay}          # back-ref to same offset previous block
Average            H{r} = =G{r}/BH{titleRow}
Electrical total   AC{r}= =Z{r}+AA{r}+AB{r}
Mechanical total   AG{r}= =AD{r}+AE{r}+AF{r}
Operational total  AK{r}= =AH{r}+AI{r}+AJ{r}
Stoppage TDY       I{r}==AC{r}  K{r}==AG{r}  M{r}==AK{r}
Stoppage CUM(dayN) J{r}==I{r}+J{r@prev}  L{r}==K{r}+L{r@prev}  N{r}==M{r}+N{r@prev}
Utilisation TDY    O{r}= =(24*60-(I{r}+K{r}+M{r}+AR{r}+AS{r}+AT{r}+AP{r}))/24/60*100
Utilisation CUM    P{r}= =(X{r}*24*60-(J{r}+L{r}+N{r}+AQ{r}+AU{r}))/X{r}/24/60*100
   (HPH row uses 16*24*60 ; CRS-5 row uses 7*24*60 — machine-specific divisors)
Prod rate          Q{r}= =(C{r}+C{r+1})/AL{r}*60   (grouping varies: 3-row, 2-row, or 1-row)
Availability CUM   AO{r}= =AL{r}+AM{r}+AN{r}  (+AO{r@prev} for dayN)
Prev-maint CUM     AQ{r}= =AP{r}  (+AQ{r@prev})
Power-fail CUM     AU{r}= =AR{r}+AS{r}+AT{r}  (+AU{r@prev})
Block grand total  BG{r}= =SUM(AR{r}:AT{r+2},AP{r}:AP{r+2},AL{r}:AN{r+2},AH{r}:AJ{r+2},AD{r}:AF{r+2},Z{r}:AB{r+2})
Today scrap total  BY{r}= =BJ{r}+BN{r}+BR{r}
Till-date scrap    CF{r}= =BY{r}  (+CF/CE{r@prev} for dayN)
Scrap %            CL{r}= =BJ{r}/(C{r}+C{r+1}+C{r+2})%   (grouping per machine)
W/R change sums    Q32==K32+M32+O32 ; R32==L32+N32+P32 ; U32==S32/X6 ; V32==T32/S32
Daily SUM row      BJ35= =BJ6+BJ8+BJ10+BJ12+BJ14+BJ16+BJ17+BJ19+BJ21+BJ23+BJ24+BJ25+BJ27+BJ29+BJ31+BJ33
Scrap% TDY/CUM     C34==BY6/F6%  ... ; C35==CF6/G6% ...
Yield              Z38= =100-(Z41+V41+0.15) ; Z41= =Z40/((CF35+G28)+(CF35+G28)*0.0015)%
```

**No formula uses a sheet-qualified reference** (no `MARCH26!`), so renaming the tab never breaks anything. Cumulative formulas reference the **previous day's block at the same offset**; day 1 has no back-reference.

---

## 8. `DELAY` sheet — complete spec

- **Repeating shift-block**, header row where `A = "LINE"`. Header rows at `1, 21, 41, 62, 83, …` → **3 blocks per day, 93 total**. Block stride ≈ 20 rows (one header + 19 machine lines + spacer).
- Block index for day `N`, shift `S` (A=0,B=1,C=2) = `N*3 - 3 + S` (scan for `"LINE"` rows in document order to be safe).

**Column widths:** `A 11.14 · B 12.0 · C default · D 19.71 · E 16.43 · F 109.57 · G 72.0`. Default row height `15.0`.

**Header row (fill `FFFF00` yellow, Calibri 12 B, medium box borders):**
`A`=`LINE`, `B`=date `01.03.2026` (nf `mm-dd-yy`, text), `C`=`SHIFT`, `D`=`TIME IN MIN.`, `E`=`AGENCY`, `F`=`REASON`.

**Machine line rows (thin `TBLR` borders, center):**
- `A` = machine name — **Arial 12 B**. Order per block (19 lines): `HRS, PKLG, 4Hi(R), 6Hi (R), 2Hi (SP), R/W LINE, HPH, CRS-1, CRS-2, CRS-3, CRS-4, CRS-5, CRS-6, CTL-1, CTL-2, CTL-3, CTL-4, CTL-5` (plus blanks).
- `B` = blank (date only on header) — Calibri 12 B.
- `C` = shift letter `A`/`B`/`C` — Calibri 12 B.
- `D` = **TIME IN MIN input** — number, or string like `"210--160"`, or `"NIL"` (Arial 10 when numeric).
- `E` = **AGENCY input** — e.g. `OP.`, `POWER`, `OP./POWER`, `NIL`.
- `F` = **REASON input** — free text (wide column).

---

## 9. Reconstruction algorithm (for Kiro)

Build the master once, in code, using a styling library that writes real cell styles (ExcelJS / openpyxl). Then store it and only ever inject daily values.

```
1. Create workbook; add sheet "<MONTH><YY>" (e.g. MARCH26) and sheet "DELAY".
2. Set sheet defaults: defaultColWidth=10.28, defaultRowHeight=15.0; set per-column widths (§3.2)
   and DELAY widths (§8). Show gridlines.
3. Define reusable named styles:
     - title (Book Antiqua 12/14/18 B, center, medium border, white fill)
     - hdr   (Arial 12 B, center, thin border, white fill)
     - inputY (Arial 10-12 B, center, thin border, fill FFFF99)
     - inputCyan (… fill 00FFFF)
     - calc  (Arial 10-12, center, thin border, fill FFCC99)
     - tgt   (… fill CCFFFF), silver (C0C0C0), ot (F4B183 / FFC000), attn (FFFF00)
   Use exact number formats from §6.
4. For dayN in 1..daysInMonth:
     base = titleRow(N)
     - write the title row (offset 0): labels, merges K:L,M:N,BI:BL,BM:BP,BQ:BT,CL:CN,CR:CT;
       set M = date string "DD.MM.YYYY"; set BH = N.
     - write header band (offsets 1-3) with all merges from §5 and labels from §4.2.
     - for each machine offset (4..29): write col-A label, apply fills per §4.3,
       write the formulas (§7) with row r=base+offset; cumulative formulas back-reference
       the previous block (base-46) for N>1, or use =F{r} for N==1.
     - write the right scrap/rej matrix + the summary band (offsets 30-41) per §4.4 and §7.
     - set row heights per §3.1.
5. For each (day, shift) build a DELAY block: yellow header (with that day's date in B),
   then the 19 machine lines with C=shift letter; D/E/F left blank for input.
6. ZERO-DATA RULE: leave every INPUT cell empty/0; keep all formulas & styles. This file is the master.
```

---

## 10. Verification checklist (must all pass)

1. Tab name matches `<MONTH><YY>`; `DELAY` tab present.
2. `MARCH26` has exactly `daysInMonth` blocks of 46 rows; first title at row 2, then +47, then +46 each.
3. Column widths and row heights match §3.1–§3.2 exactly.
4. Every fill matches the §2 legend (yellow inputs, cyan availability, peach calc, pale-cyan targets, silver sub-headers, etc.).
5. Fonts: title = Book Antiqua; body = Arial; DELAY entries = Calibri; sizes per region.
6. All 73 merges per block present (§5); DELAY header merges/borders present.
7. All formulas present and intra-sheet; cumulative chains reference the previous block; day 1 has no back-ref.
8. Number formats per §6 (`0.0` production, `0.000` scrap inputs, `mm/dd/yy` date).
9. Open in Excel: layout, colors, spacing and borders indistinguishable from the original master; only data differs.
```
