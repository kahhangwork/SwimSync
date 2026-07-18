# SwimSync brand assets

The SwimSync mark is a **poolside pace clock** — the sweep clock bolted to the wall
of a training pool. It reads as recurring time, which is what the product is: a
weekly class, a monthly billing month, a run day.

`mark.svg` is the **source of truth**. Everything else in this directory is a
recolour or a composition of it, and everything under `SwimSyncApp/assets/` and
`SwimSyncAdmin/public/` is rasterised from these files.

| File | What it is |
|---|---|
| `mark.svg` | The mark in sky `#0ea5e9`, transparent ground. The canonical geometry. |
| `mark-white.svg` | White knockout, for use on the sky tile or any dark ground. |
| `mark-ink.svg` | Single-ink `#0b2029`, for print or anywhere colour isn't available. |
| `icon-tile.svg` | White mark, full-bleed sky square. The app-icon composition — no rounding, because every OS applies its own mask. |
| `adaptive-foreground.svg` | White mark on transparent, inset to Android's adaptive-icon safe zone. Pairs with `backgroundColor` in `app.json`. |

## Geometry

64×64 viewBox. Ring `r22` at stroke `7.5` with a 24° gap at twelve; hand from
centre to one o'clock at 17 units, same weight; centre dot `r4.5`.

The **centre dot is load-bearing** — without it the hand reads as a slash rather
than a clock hand once the mark drops below about 24px. Don't remove it to
"simplify."

## Regenerating the rasters

There is no build step wired into CI; the PNGs are committed. To redraw them
after changing `mark.svg`, rasterise each SVG at the sizes below. Any renderer
works — these were produced with headless Chrome.

| Output | Source | Size |
|---|---|---|
| `SwimSyncApp/assets/icon.png` | `icon-tile.svg` | 1024 (**no alpha** — iOS rejects it) |
| `SwimSyncApp/assets/adaptive-icon.png` | `adaptive-foreground.svg` | 1024 (alpha required) |
| `SwimSyncApp/assets/splash.png` | `mark-white.svg` | 512 (alpha; sky ground comes from `app.json`) |
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
  knockout at @1x/@2x/@3x) inside a sky tile, recoloured with `tintColor`.
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
