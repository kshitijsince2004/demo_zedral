# Zedral — Brand Guidelines

**Product name:** Zedral — Production Console  
**Visual demo:** [`doc/brand-demo.html`](./brand-demo.html)  
**Token source of truth:** `packages/client/src/index.css`  
**Architecture (shells / journeys):** [`doc/design.md`](./design.md) — not visual  
**UI patterns:** [`doc/UI_UX_GUIDELINES.md`](./UI_UX_GUIDELINES.md)

---

## 1. Brand essence

Zedral Production Console is a plant-floor MES: calm, dense, and precise under pressure.

| Attribute | Value |
| --- | --- |
| Personality | Technical-clean, high trust, industrial |
| Density | Cockpit dense (information first, decoration never) |
| One-line identity | Dark forest green authority + steel-gold caution + monospace precision |

**Canonical UI:** CRM operator (6HI / 4HI / 2HI). Do not redesign those screens. Every other surface inherits this brand.

---

## 2. Naming

| Context | Form |
| --- | --- |
| Full product | Zedral — Production Console |
| Chrome / header | Production Console (OK next to machine: `Production Console · PKL`) |
| Machine codes | 6HI, 4HI, 2HI, HRS, PKL, ANN… are process labels, not alternate brands |

---

## 3. Color system

Use only these tokens. Do not invent hex values in new screens.

### Brand & surfaces

| Role | Hex | CSS token | Use |
| --- | --- | --- | --- |
| Primary / brand | `#163328` | `--color-primary`, `--color-nav` | Left rail, primary CTAs, active filters, capture process header |
| On primary | `#FFFFFF` | `--color-primary-foreground`, `--color-nav-foreground` | Text and icons on green |
| Accent / caution | `#F1B824` | `--color-accent` | **Only** END SHIFT, HOLD, PENDING (see §4) |
| On accent | `#163328` | `--color-accent-foreground` | Text on gold |
| Canvas | `#FFFFFF` | `--color-background` | App background |
| Card / muted | `#F4F6F5` | `--color-card`, `--color-muted`, `--color-secondary` | Panels, secondary fills |
| Body text | `#163328` | `--color-foreground` | Titles and values |
| Labels | `#69807A` | `--color-muted-foreground` | Uppercase field labels |
| Border | `#C5CEC9` | `--color-border` | Dividers, chrome |
| Input edge | `#A8B5AF` | `--color-input` | Field borders |
| Focus ring | `#163328` | `--color-ring` | Focus |

### Status & feedback

| Role | Hex | Token | Use |
| --- | --- | --- | --- |
| Success / synced | `#22C55E` | `--color-success`, `--color-status-running` | Synced, healthy running |
| Warning / stopped | `#F59E0B` | `--color-warning`, `--color-status-stopped` | Stopped / warn (HOLD energy with accent) |
| Info / preparing | `#3B82F6` | `--color-info`, `--color-status-setup` | PREPARING, informational ACTIVE |
| Danger / reject | `#EF4444` | `--color-destructive`, `--color-status-reject` | MANUAL STOP, backlog urgency, reject |
| Idle | `#69807A` | `--color-status-idle` | Idle / inactive |

`--color-purple` (`#8B5CF6`) is for rare chart/phase series only — never brand chrome or primary actions.

---

## 4. Accent rule (locked)

**Steel gold (`#F1B824` / `--color-accent`) is allowed only for:**

1. **END SHIFT** (solid accent button)
2. **HOLD** (caution button / hold treatment)
3. **PENDING** (and equivalent pending-class status pills)

Everything else:

- Primary actions (Save, Start, active filter, Move to Production confirm) → green primary  
- Destructive (Manual Stop, reject) → destructive red  
- Informational status → info blue / success green  

---

## 5. Typography

| Role | Family | Token / class |
| --- | --- | --- |
| UI (nav, buttons, labels, body) | IBM Plex Sans | `--font-sans` |
| Technical data (IDs, mm, MT, batch, timestamps) | IBM Plex Mono | `--font-mono` / `font-mono` |

### Hierarchy patterns

- **Field labels:** small, uppercase, muted (`text-muted-foreground`), wide tracking  
- **Values / titles:** semibold or bold, high contrast (`text-foreground`)  
- **Technical IDs & measures:** always monospace  

**Banned for product UI:** Inter, Roboto, Arial-as-brand, generic serif stacks.

---

## 6. Voice (operator-facing)

- Short verbs: START, STOPPAGE, HOLD, SAVE  
- Status in ALL CAPS pills  
- Units always shown (`mm`, `MT`)  
- No marketing fluff on the floor  

---

## 7. Do / don’t

### Do

- Reuse CRM layout grammar (left icon rail, white top bar, queue + detail / action rail)
- Use tokens from `packages/client/src/index.css` only
- Prefer primitives: `ZButton`, `ZInput`, `ZBadge`, operator filter/header components
- Keep 6HI / 4HI / 2HI visually frozen

### Don’t

- Use gold for Save / Start / primary CTAs
- Ship dark mode or a theme toggle (forever out of scope)
- Use purple as brand color
- Redesign CRM “to match” a new look
- Invent one-off hex colors per screen

---

## 8. Out of scope forever

- Dark theme / theme switcher  
- Alternate brand palettes per plant  
- Marketing gradients, neon glow, purple “AI” accents as brand identity  

---

## 9. Related docs

| Doc | Purpose |
| --- | --- |
| [`UI_UX_GUIDELINES.md`](./UI_UX_GUIDELINES.md) | Layouts, components, checklist |
| [`brand-demo.html`](./brand-demo.html) | Visual board (open in browser) |
| [`design.md`](./design.md) | Process-operator architecture (shells, journeys) |
| `packages/client/src/index.css` | Live CSS tokens |
