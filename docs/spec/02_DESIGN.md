# Protocol Radar — 02_DESIGN (UI/UX standard, materialized)

This file is the SINGLE source of truth for UI. The palette/typography/density below are
TAILORED to this system (a calm, technical "radar/console" feel). The §A universal rules
are NON-NEGOTIABLE regardless of palette.

## §A Universal rules (MUST — never violated, palette-independent)
1. NO partial-edge colored borders. A box/card/panel/callout has a UNIFORM border on all
   sides (same color + width) OR no border. Never a single-edge accent (e.g. border-left
   stripe). Signal state via: full background tint, full uniform border, or a leading icon.
2. Design TOKENS ONLY. No raw color / spacing / radius / font-size / z-index in components.
3. Every interactive element defines `:focus-visible` (full ring). Never remove `outline`
   without a replacement ring.
4. Exactly ONE filled primary CTA per view. Info/selected states stay tinted (not filled).
5. All actions keyboard-reachable. Tab strips support arrow keys.
6. Hit targets >= 32px (desktop density here; touch would be 44px).
7. Theme via `[data-theme]` only. OS preference seeds the initial value once.
8. Icons are SVG only (lucide-react / inline SVG). NEVER emoji as UI icons anywhere
   (buttons, menus, tabs, status, empty states, headings, toasts) nor as doc bullets.

## Density profile
Desktop-first console. Comfortable but information-dense grid. Base control height 36px.

## Design tokens (reference — tailored, may evolve; keep semantic roles)
Define as CSS variables under `[data-theme="light"]` / `[data-theme="dark"]`, mapped into
`tailwind.config.ts` via `theme.extend.colors` etc. Components reference token names only.

Color — semantic roles:
  --bg            light:#0f1115 is dark only; light: #f7f8fa / dark: #0f1115
  --surface       light:#ffffff / dark:#171a21
  --surface-2     light:#f0f2f5 / dark:#1e222b
  --border        light:#d8dce2 / dark:#2a2f3a      (uniform borders use this)
  --text          light:#1a1d23 / dark:#e6e9ef
  --text-muted    light:#5b6270 / dark:#9aa3b2
  --primary       light:#2563eb / dark:#3b82f6      (the single filled CTA)
  --primary-fg    #ffffff
  --info-tint     light:#eaf1ff / dark:#16243f      (selected/info background tint)
  --ok            light:#0f9d58 / dark:#34d399      (fresh / verified)
  --warn          light:#b8860b / dark:#fbbf24      (stale source)
  --danger        light:#d23f3f / dark:#f87171      (tampered / vanished)
  --focus-ring    light:#2563eb / dark:#93c5fd      (full ring)

Type scale (rem): 0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75 . Font: system UI stack
+ a mono token (`--font-mono`) for hashes/versions.
Spacing scale (px): 4 / 8 / 12 / 16 / 24 / 32 / 48.
Radius: --radius-sm 6 / --radius-md 10 / --radius-lg 14.
Shadow: --shadow-1 (subtle), --shadow-2 (popover). z-index: base/sticky/overlay/toast tokens.
Control sizing: --control-h 36px; --hit-min 32px.

## Component baselines (reference)
- Button: primary (filled, ONE per view) / secondary (tinted) / ghost. All have
  `:focus-visible` ring. Icon = SVG.
- Input / Textarea: IME-safe — Enter does NOT submit while composing (guard
  `isComposing`); submit via explicit button or Cmd/Ctrl+Enter.
- Callout: FULL light-tint background + FULL uniform border + leading SVG icon. (Used for
  stale/tampered notices.) NEVER a left-edge stripe.
- Tab strip (protocol filters): roving tabindex, ArrowLeft/Right move focus.
- Status pill: area tint + leading SVG icon + text. Roles: fresh(ok) / stale(warn) /
  tampered(danger) / vanished(danger). Color is never the ONLY signal (icon + text too).
- Toast: SVG icon + message; auto-dismiss; focusable close.
- Empty state: SVG illustration/icon + one line + optional primary action.
- Hash/version display: mono token, truncate-middle with copy button (SVG copy icon).

## UI strings
Japanese by default. Provide an en bundle for F-035. No third language. Code identifiers,
even for JA UI, stay English.

## Conformance (acceptance hook for every UI feature)
A UI feature is conformant when: tokens-only (no raw values), `:focus-visible` present on
all interactives, no emoji icons, no single-edge colored borders, one primary CTA per view.
