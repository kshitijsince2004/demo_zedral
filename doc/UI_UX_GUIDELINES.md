# Zedral — UI / UX Guidelines

**Product:** Zedral — Production Console  
**Brand:** [`doc/BRAND_GUIDELINES.md`](./BRAND_GUIDELINES.md)  
**Visual demo:** [`doc/brand-demo.html`](./brand-demo.html)  
**Tokens:** `packages/client/src/index.css`  
**Architecture:** [`doc/design.md`](./design.md) (ProcessLayout mirrors SixHi; CRM unchanged)

---

## 1. Principle

One software, one look. Surfaces differ by **job and density**, not by palette.

**CRM (6HI / 4HI / 2HI) is the visual canonical.** Process stations inherit the same shell, tokens, and patterns. Do not change CRM visuals to “align” with new work — align new work to CRM.

---

## 2. Global chrome (locked)

| Region | Spec |
| --- | --- |
| **Top bar** | White background, light bottom border. Sync pill, MANUAL STOP (danger outline), END SHIFT (gold solid), global actions |
| **Left nav** | Narrow dark green (`--color-nav`), light line icons; active = subtle highlight |
| **Main** | Light canvas + white / off-white cards |
| **Dark mode** | Forever out of scope |

**Rule:** MH / Admin / Plant / Quality use a **white top bar**, not a full-width dark green header bar. Dark green stays on the left rail and on primary buttons / capture process headers.

---

## 3. Surfaces

| Surface | Users | Chrome | Density | Notes |
| --- | --- | --- | --- | --- |
| CRM Operator | 6HI / 4HI / 2HI | Canonical | Highest | **Frozen** — reference only |
| Process Operator | HRS, PKL, ANN, RWD, CRS, CTL | Same shell via `ProcessLayout` | Highest | Match CRM Hub + Capture |
| Machine Head | Supervisors | White top + green left rail | High | Boards / tables OK |
| Plant / Admin / Quality | Office | White top + green left rail | Medium–high | Same tokens; less glove |

---

## 4. Named layouts

### 4.1 Hub / queue

```
[ green icon rail ] [ search + filter pills ]
                    [ grouped list: BACKLOG / PENDING / … ]
                    [ right detail card + primary ghost/outline action ]
```

- Filter pills: **active** = primary green fill + white text; **idle** = white + border + muted text  
- Queue groups: tinted section headers (e.g. backlog soft red wash)  
- Row data: mono for IDs and measures; status as colored pill  
- Reference: SixHi hub / queue; `ProcessHub`; `ZFilterPills`

### 4.2 Capture / production console

```
[ process header: green bar + status pill + ORDER DETAILS ]
[ Current Order meta grid — label above, value below ]
[ Production fields + variance / helpers ]
[ Passes / sub-sections + Add Pass ]
[ full-width primary: Save Production Data ]
[ right action rail: START | STOPPAGE | REMARK | HOLD ]
```

- Critical process controls live on the **right action rail**, never buried in menus  
- Status visible in header (and preferably rail)  
- Reference: SixHi capture workspace; `CaptureWorkspace`; `ProductionActionRail`

### 4.3 Top strip (global)

- Sync / connection → success (or warn) pill  
- MANUAL STOP → danger outline  
- END SHIFT → accent gold solid  

---

## 5. Spacing, radius, touch

| Rule | Value |
| --- | --- |
| Grid | 8px |
| Card padding | ≥ 16px |
| Radius | ~8px (`--radius: 0.5rem`) — stay consistent; don’t mix 4px and 20px randomly |
| Operator / glove hit targets | Prefer ≥ 44–56px (`ZButton` glove mode / `useGloveModeStore`) |

---

## 6. Component map

Prefer shared primitives over one-off styled buttons.

| Pattern | Spec | Code |
| --- | --- | --- |
| Primary button | Green fill, white text | `ZButton variant="primary"` |
| Accent button | Gold — END SHIFT only (and HOLD treatment) | accent / gold styles; see brand §4 |
| Danger outline | Red border + red text | MANUAL STOP |
| Ghost / outline | White + border | Secondary: Order Details, Move to Production… |
| Filter pills | Active green / idle bordered | `ZFilterPills` |
| Status pills | Soft bg + strong text | `ZBadge` + status colors |
| Inputs | Clear border, large enough for shop floor | `ZInput` + glove-aware min height |
| Meta grid | Label (muted uppercase) / value (bold) | Current Order card pattern |
| Action rail | Vertical critical controls | `ProductionActionRail` / SixHi rail |
| Sync badge | Always visible when offline possible | `SyncStatusBadge` |
| Page header | Operator page chrome | `ZPageHeader` |

### Accent usage map

| Control / status | Treatment |
| --- | --- |
| END SHIFT | Gold solid |
| HOLD | Gold / amber caution |
| PENDING | Gold / amber pill |
| Save / Start / active filter | Primary green |
| MANUAL STOP / reject / backlog urgency | Destructive |
| PREPARING / info ACTIVE | Info blue |
| SYNCED / healthy running | Success green |

---

## 7. Data display

- Coil IDs, batch, dimensions, weights, timestamps → `font-mono`  
- Labels → uppercase muted sans  
- Status → colored pill (never color-only text without a label)  
- Units always: `mm`, `MT`  
- Queue grouping by state with tinted headers  

---

## 8. Interaction & UX

1. Critical actions (START / STOPPAGE / HOLD) stay on a dedicated rail  
2. Status visible in at least one persistent place (header ± rail)  
3. Offline / sync always visible on operator surfaces  
4. Capture blockers: inline under fields — not toast-only  
5. Motion: short fade / slide only — no decorative motion on the floor  
6. Errors: clear, adjacent to the control that failed  

---

## 9. Anti-patterns (ban list)

- Purple / indigo marketing gradients as brand  
- Gold Save / Start buttons  
- Dark theme  
- Card overload in headers  
- Decorative icon rows with no action  
- Custom one-off hex colors  
- Redesigning CRM 6HI / 4HI / 2HI  
- Inter / Roboto as primary UI fonts  

---

## 10. Consistency checklist (before merge)

- [ ] Uses only tokens from `packages/client/src/index.css`  
- [ ] Uses `ZButton` / `ZInput` / `ZBadge` (or existing operator primitives) where possible  
- [ ] Technical data is monospace  
- [ ] Matches Hub or Capture named layout (or documented MH/Admin table pattern)  
- [ ] White top bar; green left rail  
- [ ] Gold only for END SHIFT / HOLD / PENDING  
- [ ] Touch targets OK if operator-facing  
- [ ] CRM screens untouched  

---

## 11. How this relates to `design.md`

`design.md` defines **architecture**: extract shared shell from SixHi → `ProcessLayout`; CRM stays equivalent (Requirement 14.1).

These UI guidelines define **look and interaction**. Together:

> CRM is the visual canonical. Process stations share the shell. Brand + UI docs describe that system; they do not propose a CRM redesign.
