# SwimSync brand assets

The SwimSync mark is **a wave flowing into a tick** — a swell of water that ends as a
check mark: the lesson marked, the invoice paid. Chosen 2026-10-11 as concept 2a
(`DESIGN.md` → Logo, which is the design authority; this file is the production
notes). An IPOS trademark search on it came back clear the same day. It replaced the
poolside pace clock (2026-07-19 → 2026-10-11).

`mark.svg` is the **source of truth**. Everything else in this directory is a
recolour or a composition of it, and everything under `SwimSyncApp/assets/` and
`SwimSyncAdmin/public/` is rasterised from these files.

| File | What it is |
|---|---|
| `mark.svg` | The mark in Lane Blue `#2563eb`, transparent ground. The canonical geometry. |
| `mark-white.svg` | White knockout, for use on the blue tile or any dark ground. |
| `mark-ink.svg` | Single-ink Ink `#0a0a0a`, for print or anywhere colour isn't available. |
| `icon-tile.svg` | White mark at 0.7 scale, full-bleed blue square. The app-icon composition — no rounding, because every OS applies its own mask. |
| `adaptive-foreground.svg` | White mark on transparent at 0.6 scale — the largest that keeps the tick's end inside Android's adaptive-icon safe circle. Pairs with `backgroundColor` in `app.json`. |

## Geometry

64×64 viewBox, one stroke: `M6 32Q13 21 20 32T34 32L42 42 58 18`, width **8.5**,
round caps and round joins. Thicken it as it shrinks — **9** when the mark renders at
about 32px or below, **10** at 16px — or the wave thins to a wobble. `render.mjs`
applies that by output size; the admin's inline copy uses 9 because it is only ever
drawn at 24–40px.

The mark is wide and flat (≈60×33 units with the stroke), with its visual centre at
y≈30, so the tile compositions shift it 2 units down to sit optically centred.

## Regenerating the rasters

There is no build step wired into CI; the PNGs are committed. To redraw them
after changing an SVG here, run **`node brand/render.mjs`** — it rasterises every row
below with headless Chrome (the UI drivers' `playwright-core`, so their `npm install`
must have run), and writes `favicon.ico` itself.

| Output | Source | Size |
|---|---|---|
| `SwimSyncApp/assets/icon.png` | `icon-tile.svg` | 1024 (**no alpha** — iOS rejects it) |
| `SwimSyncApp/assets/adaptive-icon.png` | `adaptive-foreground.svg` | 1024 (alpha required) |
| `SwimSyncApp/assets/splash.png` | `mark-white.svg` | 512 (alpha; the blue ground comes from `app.json`) |
| `SwimSyncApp/assets/favicon.png` | `icon-tile.svg` | 48 |
| `SwimSyncApp/assets/logo-mark{,@2x,@3x}.png` | `mark-white.svg` | 64 / 128 / 192 |
| `SwimSyncAdmin/public/icon.png` | `icon-tile.svg` | 32 |
| `SwimSyncAdmin/public/apple-touch-icon.png` | `icon-tile.svg` | 180 |
| `SwimSyncAdmin/public/favicon.ico` | `icon-tile.svg` | 16 + 32 + 48 in one ICO |

`favicon.ico` exists because browsers request `/favicon.ico` unconditionally,
regardless of the `metadata.icons` links in `app/layout.tsx` — without it those
bare requests 404.

## How each app renders it

- **`SwimSyncAdmin`** — `components/Logo.tsx` inlines the paths as a React SVG and
  colours them with `currentColor`. It is a hand-kept copy of `mark.svg`; if the
  mark is redrawn, update both.
- **`SwimSyncApp`** — `components/Logo.tsx` renders `assets/logo-mark.png` (a white
  knockout at @1x/@2x/@3x) inside a blue tile, recoloured with `tintColor`.
  Deliberately **not** an SVG component: the app has no `react-native-svg`, and
  adding a native module to a project that has not cut a native build yet is a
  risk this does not need. If `react-native-svg` arrives for another reason,
  switching is a small, contained change.

## Where the mark is deliberately *absent*

The **invoice email** (`supabase/functions/generate-invoices/email.ts`) is headed
with the **tenant's** logo and business name, not SwimSync's — a parent pays their
coach or school, and an invoice headed "SwimSync" reads as a platform bill. The
platform is named in the footer only. That is a deliberate product decision; do
not "fix" it by putting this mark in the header.

The **password-recovery email** (`supabase/templates/recovery.html`) uses a plain
text wordmark in its sky header. That is intentional too: SVG does not render in
most email clients, and a hosted PNG adds a broken-image and blocked-image failure
mode to a message the user needs in order to get back into their account.
