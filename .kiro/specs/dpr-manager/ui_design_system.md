# FORGE UI Design System

This document outlines the UI design system used in the FORGE project. It serves as a reference guide to replicate the same aesthetic, color palette, and component structures in other projects.

The design system follows a "light industrial" aesthetic using Tailwind CSS with `oklch` color spaces and the `shadcn/ui` framework (configured with the "new-york" style).

---

## 1. Typography & Spacing

### Fonts
- **Sans Serif (Primary):** `"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif`
- **Monospace:** `"JetBrains Mono", ui-monospace, Menlo, monospace`

### Border Radius
The base radius is defined as `0.75rem` (12px).
- `--radius-sm`: 8px
- `--radius-md`: 10px
- `--radius-lg`: 12px (Base)
- `--radius-xl`: 16px
- `--radius-2xl`: 20px

---

## 2. Color Palette

The project uses `oklch` colors to ensure a perceptually uniform color space. Below are the exact CSS variable mappings.

### Core Surfaces
| Token | OKLCH Value | Hex / Description |
| :--- | :--- | :--- |
| `--background` | `oklch(1 0 0)` | `#FFFFFF` (White) |
| `--foreground` | `oklch(0.275 0.035 168)` | `#163328` (Deep teal-green) |
| `--card` | `oklch(0.965 0.003 165)` | `#F4F6F5` (Off-white) |
| `--card-foreground` | `oklch(0.275 0.035 168)` | Deep teal-green |
| `--muted` | `oklch(0.965 0.003 165)` | `#F4F6F5` |
| `--muted-foreground` | `oklch(0.535 0.018 170)` | `#69807A` (Gray-teal) |
| `--border` / `--input`| `oklch(0.92 0.005 168)` | `#E2E7E5` |
| `--ring` | `oklch(0.275 0.035 168)` | Deep teal-green |

### Brand Colors
| Token | OKLCH Value | Hex / Description |
| :--- | :--- | :--- |
| `--primary` | `oklch(0.275 0.035 168)` | `#163328` (Primary brand color) |
| `--primary-foreground`| `oklch(1 0 0)` | White text on primary |
| `--accent` | `oklch(0.79 0.155 86)` | `#F1B824` (Gold) |
| `--accent-foreground` | `oklch(0.275 0.035 168)` | Deep teal-green |

### Status Palette
| Token | Description | Foreground |
| :--- | :--- | :--- |
| `--success` | `oklch(0.62 0.14 152)` (Green) | White |
| `--warning` | `oklch(0.76 0.14 75)` (Amber) | Deep teal-green |
| `--info` | `oklch(0.6 0.13 245)` (Blue) | White |
| `--destructive` | `oklch(0.6 0.21 27)` (Red) | White |

### Sidebar & Navigation Phase Colors
- `--nav-bg`: Deep teal sidebar `oklch(0.235 0.03 168)`
- `--phase-platform`: `#8B5CF6`
- `--phase-setup`: `#64748B`
- `--phase-collect`: `#3B82F6`
- `--phase-analyse`: `#F59E0B`
- `--phase-act`: `#10B981`

> [!TIP]
> When replicating this color scheme, ensure that Tailwind CSS configuration supports CSS variables using `var(--color-name)` mapping to support these custom `oklch` strings out of the box.

---

## 3. Component System: Buttons

Buttons are built with accessible defaults, smooth transitions, and distinct sizing for mobile-first touch optimization. 

### Base Button Styles
```css
inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50
```

### Variants
- **Default:** `bg-primary text-primary-foreground shadow hover:bg-primary/90`
- **Destructive:** `bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90`
- **Outline:** `border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground`
- **Secondary:** `bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80`
- **Ghost:** `hover:bg-accent hover:text-accent-foreground`
- **Link:** `text-primary underline-offset-4 hover:underline`

### Sizing (Mobile-First Touch Targets)
Notice how `default`, `sm`, and `lg` variants implement larger sizes and minimum heights (`min-h-11`, `min-h-10`) on mobile by default, and shrink slightly on `md:` breakpoints for desktop optimization.
- **Default:** `h-11 min-h-11 px-4 py-2 md:h-9 md:min-h-0`
- **Small (sm):** `h-10 min-h-10 rounded-md px-3 text-xs md:h-8 md:min-h-0`
- **Large (lg):** `h-12 min-h-12 rounded-md px-8 md:h-10 md:min-h-0`
- **Icon:** `h-11 w-11 min-h-11 min-w-11 md:h-9 md:w-9 md:min-h-0 md:min-w-0`
- **Touch (Extra Large):** `h-14 min-h-14 px-6 text-base rounded-lg`

---

## 4. Component System: Cards

The Card component serves as a fundamental layout surface.

### Anatomy and Classes
- **Card (Container):** 
  `rounded-xl border bg-card text-card-foreground shadow` 
  *(Note the rounded-xl which equates to `--radius-xl` / 16px)*
- **CardHeader:** 
  `flex flex-col space-y-1.5 p-6`
- **CardTitle:** 
  `font-semibold leading-none tracking-tight`
- **CardDescription:** 
  `text-sm text-muted-foreground`
- **CardContent:** 
  `p-6 pt-0` *(Padding 24px, except top to collapse with header)*
- **CardFooter:** 
  `flex items-center p-6 pt-0`

---

## 5. Animations & Global Utilities

The design system incorporates custom animations mapping directly in the CSS root.

```css
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.2; }
}
.animate-pulse-dot { animation: pulse-dot 1.6s ease-in-out infinite; }

@keyframes slide-in {
  from { transform: translateY(8px); opacity: 0; }
  to   { transform: translateY(0);   opacity: 1; }
}
.animate-slide-in { animation: slide-in 0.3s ease-out both; }
```

### Scrollbars
The design system overrides default scrollbars to be thin, transparent, and themed with the foreground color.
```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: color-mix(in oklab, var(--color-foreground) 18%, transparent);
  border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklab, var(--color-foreground) 32%, transparent);
}
```

## Summary for Replication
To replicate this in a new project:
1. Initialize a new project with Tailwind CSS and Shadcn-UI.
2. Ensure you are using `oklch` support (Tailwind v4+ or via fallback configurations).
3. Copy the Color Palette mapped in `:root` and `@theme`.
4. Overwrite Shadcn-UI's `button.tsx` to include the specific size definitions (`h-11 min-h-11 ... md:h-9`) for responsive touch targets.
5. Apply `rounded-xl` and `shadow` as the default card container aesthetic in `card.tsx`.
