---
name: mobile-design
description: Mobile design system reference for Mucka Pro — native iOS/Android app via Capacitor (Path B hosted WebView) with PWA fallback at alrightmucka.com. Use when building or modifying mobile views, adding new mobile pages, or fixing mobile CSS. Covers aesthetic intent, page anatomy, shared mucka-* class names, button/icon/pill primitives, card patterns, native-app integration, migration phases, and the gotchas we hit along the way.
argument-hint: [page-name]
---

# Mucka Pro — Mobile Design System

The source of truth is the live code. This skill captures the decisions, patterns, and gotchas behind it.

> **Delivery context.** Mucka Pro ships as a **native iOS/Android app** via Capacitor 8 (Path B hosted WebView wrapping `alrightmucka.com`) and as a PWA on the same URL. Most users get the native app. Design must feel native — respect safe areas, fire haptics on primary actions, honour edge-swipe-back, integrate camera/biometric/push plugins, avoid web-isms.

## Where things live

| What | Path |
|---|---|
| **Primitives** | `src/components/ui/{Button,Icon,StatusPill,cn}.tsx` |
| **Brand SVGs** | `public/brand/{mucka-wordmark,mucka-icon-m}.svg` |
| **Bolt PNG/GIF** | `public/mucka-bolt-{black-static.png,mobile.gif}` |
| **Söhne fonts** | `public/fonts/soehne/*.woff2` (6 weights) |
| **Tokens + classes** | `src/app/globals.css` (search "DESIGN SYSTEM v2") |
| **Foundation spec** | `/icons-buttons` (project root) |
| **Mobile pages** | `src/components/mobile/Mobile*.tsx` |
| **Global chrome** | `MobileNav.tsx` (tab bar) + `MobileVoiceFAB.tsx` (voice bolt) |
| **Demo page** | `src/app/ui-demo/UiDemo.tsx` (live at `/ui-demo`) |

**Rule of thumb**: when you need a button, pill, or icon, import from `@/components/ui/`. Don't roll your own. If a variant is missing, extend the primitive.

## Aesthetic intent

Bold, tradesperson-friendly, "tools-on-the-van" energy — not dashboard-clean.

- Big display typography (Söhne Breit Kräftig).
- Vibrant orange primary actions, chunky and unmissable. Black-on-orange labels, never white.
- Calm light canvas: page bg is `--surface2`, cards are `--surface`. Charcoal for active states + secondary buttons.
- The brand silhouette is octagonal — 4 chamfered corners. Buttons, avatars, cards, the M-icon mark — all share it.
- Native gestures honoured. iOS edge-swipe-back must work; sidebar opens via the **More** tab, not a left-drag.

What this is NOT: rounded-glass dashboard, gradient-mesh aesthetics, density-first SaaS, anything that reads as "a website on a phone".

## Page anatomy

Every list page is the same five layers:

1. **Status bar** — system. Page bg `--surface2` extends underneath via `padding-top: env(safe-area-inset-top, 0px)` on the page wrapper.
2. **Floating voice bolt** — fixed top-right (rendered globally by `MobileVoiceFAB`, not per-page). Tap → dispatches `mobile-voice-tap` → `AuthedShell` opens `MuckaPanel` in voice mode. **No wordmark in chrome** — this is a B2B tool, users know what app they're in.
3. **Big H1** — `t-display-lg` (40px Söhne Breit Kräftig, charcoal). The page title carries the page identity.
4. **Search row** + **full-width primary CTA** + **segmented filter tabs** (when applicable).
5. **Card list** — `--surface2` background, 10–12px gap between cards. Bottom padding clears the fixed tab bar.

Detail screens (Quote/Invoice) replace layers 3–4 with a Detail Header (`← Back` + ID title) and add a Sticky Bottom Action Bar (Edit + Send Quote pattern).

## Shared `mucka-*` classes (live, in `globals.css`)

Use these directly — they're the page chrome. Look for the "DESIGN SYSTEM v2 — mobile page chrome" block at the bottom of `globals.css`.

| Class | What it is |
|---|---|
| `.mucka-page` | Page wrapper. Sets `--surface2` bg, top safe-area padding, bottom tab-bar clearance. |
| `.mucka-page-title` | Big H1 styling. Compose with `t-display-lg`. |
| `.mucka-fab` | Floating voice bolt. Owned by `MobileVoiceFAB`. Don't add it per page. |
| `.mucka-search` + `.mucka-search-input` + `.mucka-search-icon` + `.mucka-search-filter-btn` | Search row. |
| `.mucka-page-cta` | Margin wrapper around the page-level Primary CTA `<Button>`. |
| `.mucka-segmented` + `.mucka-segmented-tab` + `.mucka-segmented-tab-active` | Segmented filter tabs (All / On Site / Scheduled / Completed). |
| `.mucka-tabbar` + `.mucka-tabbar-tab` + `.mucka-tabbar-tab-active` | Bottom tab bar. Owned by `MobileNav`. |
| `.mucka-empty` | Centred empty-state container. |

Page-specific patterns get their own descriptive name — e.g. `.mucka-jobs-card` for the Jobs row card. Keep the `mucka-` prefix.

## Button library

`<Button>` from `src/components/ui/Button.tsx`. Variants × sizes × tones × icon slots:

| Variant | Use | Anatomy |
|---|---|---|
| `primary` | Page CTAs, confirm actions | Orange, dovetail silhouette, BLACK label + icon, leading-icon chip (charcoal sq with white glyph), V-notch on bottom-right wrapping the trailing arrow. Auto-adds `ArrowRight` trailing unless `trailingIcon={null}`. |
| `secondary` | Paired with primary in dual-button bars | Soft van-white, dovetail silhouette, charcoal label + icon (no chip), V-notch on top-left when leading icon present. |
| `dark` | Navigation rows / menu items ("View / Open >") | Charcoal fill, white label + icon, octagonal silhouette (no V-notch). Label flex-1 + trailing chevron docks right. |
| `tertiary` | Cancel, Download, Share, Delete, etc. | Outlined, octagonal. `tone` prop: `default` (charcoal) / `orange` / `danger` (red). |
| `ghost` | Back, dismiss, in-card actions | Flat, no border, no fill until hover. |

Sizes (heights): **lg = 50px, md = 42px, sm = 34px**. (Trimmed from spec's 56/48/40 — feels right; tertiary heights match these for clean pairing.)

Always pass `leadingIcon`/`trailingIcon` as Lucide icon components, not pre-rendered JSX. Primary fires `triggerHaptic('light')` automatically; override via `haptic="medium"` for confirm/destroy actions.

### Brand silhouette geometry (the gotchas)

- **Corner chamfers (`--notch`)**: 7 / 6 / 5 px at lg / md / sm. All four corners.
- **V-notch position (`--vnotch-pos`)**: 36 / 30 / 24 px from the right edge for primary's trailing tab; from the left edge for secondary's leading tab. ~70% of button height — narrower than tall, so the label has room.
- **V-notch dims**: `--vnotch-w` 8/7/6 px, `--vnotch-d` 5/4/3 px.
- **Padding-right override on primary with trail-notch**: 9 / 7 / 5 px, so the trailing arrow centres horizontally within the V section (math: `vnotch_pos/2 - icon_size/2`).
- **Icon-chip dims (primary leading)**: 36 / 30 / 24 px square. Inner Lucide icon: 16 / 14 / 12 px.

### Tertiary's two-pseudo-element trick (important — DO NOT change)

`clip-path` clips the `border` along with the box, so a `border: 1.5px` outlined button with octagonal `clip-path` ends up with no border on the chamfer edges. Solution: `::before` is the outline-coloured layer (clipped to the silhouette), `::after` is the interior (clipped to a SLIGHTLY-SMALLER silhouette, inset by 1.5px). Result: a continuous 1.5px ring on all 8 edges.

Math note: the inner `--notch` is `calc(var(--notch) - 0.88px)`. Why? When you inset a polygon 1.5px on all sides, the chamfer line only moves perpendicular by `1.5/√2`, not 1.5 — so straight edges and chamfer edges drift apart unless you compensate. The 0.88 is `1.5*(√2 - 1) - 1.5` simplified.

### Tertiary hover gotcha

Hover bg MUST stay opaque, otherwise the charcoal `::before` underneath bleeds through and turns the button into a solid black block with invisible text. Use `color-mix(in srgb, var(--tertiary-bg), var(--charcoal) 5%)` (or 8% for orange/danger tones). Translucent rgba bg = bug.

## Status pills

`<StatusPill variant="...">` from `src/components/ui/StatusPill.tsx`. Six variants:

| Variant | Tint | Meaning |
|---|---|---|
| `on-site` | orange | active engagement |
| `pending` | softer orange | waiting on action |
| `scheduled` | grey | inert future |
| `completed` | green | finished |
| `quote-sent` | green | finished pre-job |
| `cancelled` | grey | inert dead |

Framing: **orange = Mucka actively engaged**, green = work finished, grey = inert/waiting. Locked 2026-05-04.

Mapping from job system_keys: `active → on-site`, `scheduled → scheduled`, `completed → completed`. `pending` / `quote-sent` / `cancelled` come from other domains (quotes, invoices).

## Icons

`<Icon icon={LucideIcon} />` from `src/components/ui/Icon.tsx`. Defaults: size 24, strokeWidth 2.25, currentColor.

Lucide is the **only** icon source. No custom SVGs in `mobile/icons/`, no inlined `<svg>` blocks except for one-offs. Trade-specific glyphs (Plumbing, Electrical, Tiling, etc.) are NOT in scope yet — those will be commissioned as a custom set later. Use `Hexagon` as a generic job/work avatar mark for now.

Common mobile sizes: nav tab 22, in-row trail 20, search 18, card avatar 26 (inside a 56px chip).

## Card patterns (live)

### Job card (`.mucka-jobs-card`)
- Octagonal charcoal avatar (56×56) with white `Hexagon` glyph.
- Three-line body: title (`t-heading-md`), client name (`t-body-md` `--ui-grey`), date+address line (`t-body-sm` `--ui-grey`).
- Trail (vertical centre): `<StatusPill>` then `<ChevronRight>` `--ui-grey`.
- Card itself is octagonal (clip-path, 14px notch).

### Client card pattern
- Octagonal charcoal avatar with white initials (Söhne weight 600).
- Single-line name (`t-heading-lg`). NO email/phone — keeps the row Apple-Contacts-tight.
- Trail: outlined-orange octagonal phone button (LIGHTER orange outline `rgba(255, 78, 0, 0.25)`, full-orange phone glyph inside) + `<ChevronRight>`.

### Sticky bottom bar (Quote / Invoice detail)
`<Button variant="secondary" size="lg" leadingIcon={Pencil}>Edit</Button>` + `<Button variant="primary" size="lg" leadingIcon={Send} fullWidth>Send Quote</Button>` (with `style={{ flex: 1 }}` on the primary). Both at lg = 50px so they align.

### Modal pair (Cancel / Confirm)
`<Button variant="tertiary" size="md">Cancel</Button>` + `<Button variant="primary" size="md" leadingIcon={Check} fullWidth>Confirm</Button>` (flex 1). Both at md = 42px so they align — tertiary inherits base heights (this was a fix; don't override tertiary heights).

## Bottom tab bar

`MobileNav` in root layout. **5 fixed tabs** — Home / Jobs / Clients / Schedule / More. No floating centre voice button (moved to `MobileVoiceFAB`).

- Lucide icons via `<Icon>`: `Home / Briefcase / Users / Calendar / MoreHorizontal`.
- Active tab: `--orange` icon + label.
- "More" doesn't navigate — it dispatches `mobile-more-tap` → `AuthedShell` opens the existing `<Sidebar>` drawer. Sidebar gets its own redesign later.
- Excluded routes (no nav, no voice bolt): `/login`, `/signup`, `/auth`, `/admin`, `/invite`, `/onboarding`, `/pending`, `/offline`, `/ui-demo`.

## Typography (Söhne)

Wired via `next/font/local` in `src/app/layout.tsx`. CSS variables: `--font-soehne` (body) and `--font-soehne-breit` (display). The 12 utility classes:

`t-display-{xl,lg,md}` (Breit Kräftig 56/40/32px)
`t-heading-{lg,md,sm}` (Söhne 22/18/12px, the sm is the uppercase eyebrow)
`t-body-{lg,md,sm}` (Söhne Buch 16/14/12px)
`t-label-{lg,md,sm}` (Söhne Kräftig 16/14/11px, the sm is uppercase)

**Phase A doesn't repoint `--font-heading` or `--font-body`** — the legacy Bebas Neue / DM Sans variables still drive the desktop dashboard. Phase B repoints them globally. Don't preempt this.

## Tokens (live)

Existing canonical tokens (don't rename): `--orange`, `--charcoal`, `--van-white`, `--dirty-grey`, `--surface`, `--surface2`, `--border`, plus status tokens.

V2 aliases (additive): `--black` → `--charcoal`, `--white` → `--van-white`, `--ui-grey` → `--dirty-grey`. Plus the 12 pill colour vars (`--pill-{onsite,pending,scheduled,completed,quote,cancelled}-{bg,fg}`).

## Native-app integration

- **Haptics**: `<Button variant="primary">` fires `triggerHaptic('light')` on click. Helper at `src/lib/native/haptics.ts`. No-op on web. Override with `haptic="medium"` for confirm/destroy actions, `noHaptic` to disable.
- **Camera capture**: photo flows go through `src/lib/native/camera.ts` (Capacitor Camera plugin on native, `<input type="file" capture>` on web). Don't add raw file inputs.
- **Edge-swipe back**: detail screens must work with iOS swipe-from-left. The `← Back` button calls `router.back()` so swipe and button do the same thing. **Do not** install gesture handlers on the leftmost ~20px of detail screens.
- **Sidebar opening**: only via the **More** tab on mobile. No left-drag-to-open — that traps the OS edge-swipe.
- **Status bar**: `capacitor.config.ts` sets light style (dark icons on `--surface2`). Don't override per page.
- **Push**: `setupPush()` in `AuthedShell`. Triggers live for job assignment, invoice paid, new Google review. Tokens are pruned in `src/lib/push/send.ts`.

## Phase progress

The mobile-first refresh ships in three phases — don't conflate them.

| Phase | Scope | Status |
|---|---|---|
| **A.1** | Wire Söhne + v2 tokens | ✅ done (a63ecd9) |
| **A.2** | Build `<Button>` / `<Icon>` / `<StatusPill>` primitives + `/ui-demo` | ✅ done (8c9d668 + iterations) |
| **A.3** | Skin mobile pages one by one with new system | ⏳ in progress |
| → Jobs | Live | ✅ shipped (bd52bf1) |
| → Clients | Pending | — |
| → Schedule | Pending | — |
| → Home | Pending | — |
| → Detail screens (Quote, Invoice, Job) | Pending | — |
| → Auth (login/signup) | Pending | — |
| **B** | Repoint `--font-heading` / `--font-body` to Söhne, audit desktop, migrate desktop primary actions to `<Button>` | not started |
| **C** | Remove Bebas Neue + DM Sans, drop legacy `.pill .p-*` and `.mjobs-*` classes | not started |

Phase A.3 bar: "would this commit visibly change a desktop page?" — if yes, defer to Phase B.

## Common gotchas

- **Tailwind v4 + Turbopack HMR cache**: when you add a new CSS class to `globals.css`, the served CSS may not regenerate until you **restart the dev server**. Symptom: rules look correct in the file but the browser doesn't render them. Fix: kill `next dev` and restart. Hit this twice while building Phase A.
- **TypeScript test errors are pre-existing**: `tsc --noEmit -p .` reports errors in test files (`@types/jest` not installed, `authUserId` field missing). These are unrelated to the design system work — filter to your touched files when checking.
- **`useSearchParams()` requires `<Suspense>`** for static generation in Next.js 16.
- **Safe-area insets differ** between iOS Safari, standalone PWA, and Capacitor native shell. Test in all three.
- **Web-only changes ship instantly via Vercel; native shell changes need a fresh archive.** Adding a Capacitor plugin or editing `capacitor.config.ts` = TestFlight rebuild required. UI/CSS changes pick up automatically on next foreground.
- **iOS simulator unreliable for FCM push** — confirm push end-to-end on a real iPhone.
- **Don't use clip-path with a regular `border`**: the chamfer edges lose their border. Either use the two-pseudo-element trick (tertiary), use a pure fill (primary/secondary/dark), or use SVG.
- **Don't use translucent rgba for tertiary hover bg**: the `::before` outline bleeds through. Use `color-mix()` for opaque tints.
- **`color-mix(in srgb, ...)` requires modern engines** — Safari 16.2+, Chrome 111+, Firefox 113+. Capacitor WebView is fine; ancient PWA users may not be — flag if it ever becomes a concern.
- **Don't gate UI visuals on `isNative()`.** Native and web should look identical. Only gate native-specific *capabilities* (haptics, camera plugin, biometric).

## Brand assets

- **Wordmark SVG** (`public/brand/mucka-wordmark.svg`): use on auth splash and any context where the wordmark needs to scale or recolour. Söhne Breit Kräftig **cannot** reproduce it — the brand has hand-built quirks (X spur on the U, hex-joint on the C, dovetail K-leg). The SVG is `currentColor`, so `color: var(--orange)` themes it.
- **Icon-only M** (`public/brand/mucka-icon-m.svg`): for app-icon-style contexts and compact lockups.
- **Bolt** (`public/mucka-bolt-{black-static.png,mobile.gif}`): kept as bitmap so the static idle frame and the animated active frame stay pixel-identical. Never CSS-filter them.

## Component file location

Mobile components live in `src/components/mobile/`:
- `MobileHome.tsx`, `MobileMyJobs.tsx`, `MobileJobs.tsx` (skinned in A.3)
- `MobileClients.tsx`, `MobileSchedule.tsx`, `MobileEngineers.tsx` (still old design)
- `MobileNav.tsx` (rebuilt in A.3 — 5 tabs, no floating centre)
- `MobileVoiceFAB.tsx` (new in A.3 — global floating bolt)
- `MobileShell.tsx`, `MobileTabBar.tsx` (legacy — being phased out as pages migrate)

CSS lives in `src/app/globals.css`. **Not** in `@media` queries — visibility is controlled by the shell's `isMobile` state; mobile components only render at `≤767px`.
