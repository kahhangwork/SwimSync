---
name: SwimSync
description: Visual design system for the SwimSync parent app, coach app and admin panel
colors:
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  ink: "#0a0a0a"
  ink-secondary: "#525252"
  ink-muted: "#6b6b6b"
  ground: "#fafafa"
  surface: "#ffffff"
  border: "#e5e5e5"
  border-strong: "#d4d4d4"
  divider: "#f0f0f0"
  selected: "#ededed"
  status-neutral-text: "#525252"
  status-neutral-bg: "#f5f5f5"
  status-neutral-border: "#e5e5e5"
  status-info-text: "#1e40af"
  status-info-bg: "#eff6ff"
  status-info-border: "#bfdbfe"
  status-warning-text: "#92400e"
  status-warning-bg: "#fffbeb"
  status-warning-border: "#fde68a"
  status-danger-text: "#b91c1c"
  status-danger-bg: "#fef2f2"
  status-danger-border: "#fecaca"
  status-success-text: "#166534"
  status-success-bg: "#f0fdf4"
  status-success-border: "#bbf7d0"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-secondary:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
  money:
    fontFamily: "Geist, system-ui, sans-serif"
    fontFeature: "\"tnum\" 1"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 16px"
  button-disabled:
    backgroundColor: "{colors.status-neutral-bg}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
  status-tag:
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 12px"
---

# Design System: SwimSync

> **This is the VISUAL design system** — colours, type, spacing, components and the logo: what a screen
> should look like. It is **not** code architecture; that is `docs/ARCHITECTURE.md` and the feature write-ups in
> `docs/design/`. The name `DESIGN.md` is a standard (Google's DESIGN.md format) that design tools such as
> Impeccable load automatically, which is why it is not called anything else.
>
> **Status (2026-10-11): target, not yet adopted.** The apps today still use Tailwind sky (`#0ea5e9`), white
> cards with shadows and the pace-clock logo. Screens move to this system one at a time under BACKLOG
> *UI/UX improvements* — never in one sweep (the UI drivers assert on visible text). Until a screen is
> migrated, its code is not evidence against this file. Chosen from three drawn directions; mock-ups:
> https://claude.ai/artifact/2gSDdtZbKEb3pVnmDiVEKK · logo concepts: https://claude.ai/artifact/PxWBq9tXtsBYZEgnnvRYKT

## Overview

**Creative North Star: "The Pool Deck Clipboard"**

SwimSync is the clipboard a coach carries along the pool deck and the statement a parent checks at the end of
the month: plain, legible, trusted with money. The look borrows the restraint of the Cloudflare dashboard and
Tailwind's Catalyst kit — neutral greys, thin borders, one blue — because every screen is an **Operate** surface:
somebody is marking a lesson, paying an invoice or closing a billing month, and the design's job is to get out
of the way and make the next action and the state of things unmistakable.

Character lives in precision, not decoration: aligned money, honest status words, a blocked month that looks
blocked. The same system serves three very different readers — a coach with wet hands and one thumb, a parent
who opens the app once a month, and an admin working a 30-row table — so density changes per surface, but
colours, type, status meanings and shapes never do.

**Key characteristics:**
- Flat surfaces separated by 1px borders; no card shadows.
- One accent colour, used only for the single primary action and links.
- A five-step status scale shared by all three apps, always paired with a word.
- Geist throughout; money in tabular figures.
- 44px touch targets on mobile; denser 36px controls on the admin desktop.

## Colors

A near-monochrome system with one confident blue and a fixed status scale.

### Primary
- **Lane Blue** (`#2563eb`): the one primary button per screen or section, links, focus rings and the active
  navigation indicator. White text on it passes 4.5:1 (≈5.2:1). Hover `#1d4ed8`.

### Neutral
- **Ink** (`#0a0a0a`): headings, body text, the active tab label, amounts.
- **Ink Secondary** (`#525252`): supporting lines, inactive tab and nav labels, table cell text that is not the key.
- **Ink Muted** (`#6b6b6b`): table headers, captions, timestamps. Never below 12px.
- **Ground** (`#fafafa`): the screen background behind cards and the admin sidebar.
- **Surface** (`#ffffff`): cards, tables, inputs, the tab bar.
- **Border** (`#e5e5e5`) and **Border Strong** (`#d4d4d4`): card and container outlines; outlined buttons and inputs.
- **Divider** (`#f0f0f0`): lines inside a card or between table rows.
- **Selected** (`#ededed`): the fill behind the current page in the admin sidebar and a selected segment.

### Status scale — one meaning per colour, in all three apps

Each status is a text / background / border trio, and it always appears as a **word** in a tag — colour is never
the only signal.

| Status | Means | Text · Bg · Border | Examples |
|---|---|---|---|
| **Neutral** | Nothing to do yet | `#525252` · `#f5f5f5` · `#e5e5e5` | Upcoming · Not run yet · No students · Open (month not generated yet, nothing blocking) |
| **Info** | Waiting on someone else | `#1e40af` · `#eff6ff` · `#bfdbfe` | Claimed (parent says paid, admin to confirm) · Pending package · Awaiting confirmation |
| **Warning** | Needs doing soon | `#92400e` · `#fffbeb` · `#fde68a` | Due · Not marked (today's lesson) · 3 of 5 marked |
| **Danger** | Stuck or overdue — someone must act to unblock | `#b91c1c` · `#fef2f2` · `#fecaca` | Overdue · Blocks billing (a past lesson unmarked) · Last run failed |
| **Success** | Done | `#166534` · `#f0fdf4` · `#bbf7d0` | Paid · Marked · Closed |

### Named Rules
**The One Blue Rule.** `#2563eb` is the only blue. Links use it too; there is no second link blue. Info tags use
their own darker `#1e40af` text on a tint, never the accent as a fill.

**The Red Means Stuck Rule.** Red is reserved for something that is blocked or overdue and needs a person to
unblock it. An invoice that is merely unpaid and within its month is **Due** (amber), not red. A billing month is
red only while something blocks it; an open month that just has not been generated is neutral.

**The Claimed Is Its Own State Rule.** "Parent says paid" is never a grey footnote under a red badge. It is an
**Info** tag, it is the admin's most actionable state, and its row action is *Confirm payment*.

## Typography

**Font:** Geist (fallback `system-ui, sans-serif`) for everything. No second family, no mono in the UI.

**Character:** crisp and technical, softened by generous line height and plain-English labels.

### Hierarchy
- **Display** (600, 24px, line-height 1.2, −0.02em): the screen title on mobile ("Billing", "Coach Daniel"). Admin
  page titles 26px.
- **Headline** (600, 16px, 1.3): card titles — "September 2026", a class name.
- **Body** (400, 14px, 1.5): rows, amounts, button labels (buttons use 600).
- **Body Secondary** (400, 13px, 1.45, `#525252`): the line under a title — "Ethan · 8 lessons · due 15 Oct".
- **Label** (500, 12px): status tags, tab-bar labels, table headers. **12px is the floor for any text.**

### Named Rules
**The Aligned Money Rule.** Every amount uses tabular figures (`font-variant-numeric: tabular-nums`), is
right-aligned in tables and rows, and is written `S$1,260.00`; a reduction is `−S$30.00` with a true minus.

**The Plain Words Rule.** Label money the way a parent would say it: "8 lessons", "Credit", "To pay" — never
"Gross" or "Net" on a parent screen. The admin table may keep Gross / Net column headers.

**The One Date Style Rule.** Dates read `15 Oct`, `Thu 8 Oct`, `Sep 2026`, `22 Sep 2026` — never `8/10/2026`.
Display goes through `formatSgStamp()` (CLAUDE.md, §7.229).

## Layout

- **Mobile (parent, coach):** 390px reference width, 20px side gutter, sections stacked with 20px gaps, 8px
  inside a section. The primary action sits in the lower half of the screen where a thumb reaches it.
- **Admin desktop:** a 232–260px sidebar on the Ground colour, content on Surface with 32px × 40px padding.
  Below ~800px the sidebar stacks above the content. Wide tables scroll inside their own bordered box.
- **Spacing scale:** 4 · 8 · 12 · 16 · 20 · 24 · 32px. Nothing off-scale.
- **Density:** mobile controls are 44px tall; admin controls 36px (row buttons 30px).

## Elevation & Depth

Flat by default. Cards, tables and the tab bar are separated by 1px borders on a Ground background, never by
shadows. The only shadow is for things that float above the page — modals, dropdown menus, toasts:
`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08)`.

**The Flat-By-Default Rule.** If it does not float, it does not cast a shadow.

## Shapes

Small, consistent corners: tags 4px, buttons and inputs 6px, cards and containers 8px. No pills, no fully-rounded
buttons, no corner radius above 8px except the app icon tile. Status dots are 8px circles and always sit beside
a word.

## Components

### Buttons
- **Primary:** Lane Blue fill, white 600 text, 6px corners, 44px mobile / 36px admin. **One per screen or section**
  — it names the thing the screen exists for ("Pay S$210.00 via PayNow", "Mark attendance", "Generate invoices").
- **Secondary:** white with a `#d4d4d4` border and Ink text, same size. Everything that is not the main action.
- **Text link:** Lane Blue. A standalone link ("Already paid? Let Splash know", "View details") has no underline
  at rest and underlines on hover; a link **inside a sentence is always underlined**, so colour is not its only
  signal. At least 44px tall on mobile.
- **Destructive** (Write off, Void, Cancel package): secondary style with Danger text `#b91c1c`, always behind a
  confirmation step (in the mobile app `confirmAction`, `SwimSyncApp/lib/confirm.ts` — never `Alert.alert`, which
  does nothing on RN-web).
- **Disabled:** `#f5f5f5` fill, `#6b6b6b` text, and **the reason shown next to it** (see the Blocked-Action Rule).
- **Focus:** 2px Lane Blue ring, 2px offset, on every interactive element.

### Status tags
12px / 500, 4px corners, 1px border, `2px 6px` padding, colours from the status scale. One tag per row or card,
top-right on cards, its own column in tables.

### Cards
White Surface, 1px Border, 8px corners, 16px padding, no shadow. Internal sections split by a Divider line.

### Inputs
White, 1px Border Strong, 6px corners, 44px mobile / 36px admin, visible label above (never placeholder-only).
Focus: Lane Blue border plus the focus ring. Errors: Danger text directly under the field. Picking a month or a
date is a picker, never a free-text field.

### Tables (admin)
Header row on Ground with 12px Ink Muted labels; rows separated by Divider; key column (parent name) in 500
weight; money right-aligned and tabular. **At most one inline action per row** — the one the row's state calls
for (Due → *Mark paid*, Claimed → *Confirm payment*); everything else in a row "…" menu, and repeated actions
across rows go in a bulk-selection bar.

### Navigation
- **Mobile tab bar:** white, 1px top border, 64px tall plus `env(safe-area-inset-bottom)`. Inactive labels 12px
  `#525252`; the active tab is Ink 600 **with a 2px Lane Blue indicator** — never shade alone.
- **Admin sidebar:** Ground background, 14px links in Ink Secondary; the current page has the Selected fill, Ink 600
  text and `aria-current="page"`. Count badges use the status colour of what they count (unmarked lessons = Danger).

### Logo — concept 2a, "wave into a tick"
A single stroke: a swell of water that flows into a tick — the lesson marked, the invoice paid.
- **Geometry (64×64 viewBox):** `M6 32Q13 21 20 32T34 32L42 42 58 18`, stroke width 8.5 (9 at 32px, 10 at 16px),
  round caps and joins.
- **Colour:** Lane Blue on light grounds; white on Lane Blue for the app-icon tile; white on Ink for dark grounds.
- **Lockup:** mark left of the "SwimSync" wordmark in Geist 600, −0.03em.
- **Not yet shipped** — `brand/` still holds the pace clock. Replacing it is its own change: `brand/` sources,
  both `components/Logo.tsx`, and every raster listed in `brand/README.md`. Run an IPOS trademark search first.

### Signature behaviours (from the 2026-10-11 critique)
**The Blocked-Action Rule.** An action the system will refuse is shown **disabled with the reason beside it and a
link to fix it** — "Generate invoices · 2 lessons unmarked → Review". Never a live-looking primary button that
fails on press.

**The Pay-First Rule.** On a parent invoice, *Pay via PayNow* is the full-width primary; *Already paid?* is a text
link beneath it, never an equal button beside it. After a claim the card shows an **Info** tag — "Claimed ·
awaiting confirmation" — so the parent leaves reassured.

**The Blocker-Outranks-Routine Rule.** Anything that blocks billing (an unmarked past lesson) is the loudest thing
on the coach's screen: a Danger container above *Today*, the consequence in words ("Blocks September billing"),
and the screen's primary button. A routine lesson happening now does not outrank it.

## Do's and Don'ts

### Do:
- **Do** use exactly one Lane Blue primary per screen or section.
- **Do** pair every status colour with a word, from the five-step scale only.
- **Do** keep all text at 12px or larger and at least 4.5:1 contrast.
- **Do** right-align money in tabular figures.
- **Do** say why an action is disabled, right next to it.
- **Do** design the empty state and the long-name case ("Wei Ling Ong", "Emma, Noah") for every list.

### Don't:
- **Don't** add shadows to cards, gradients, glassmorphism, or emoji as icons.
- **Don't** introduce a second blue, a second font, or radii above 8px.
- **Don't** use red for a plain unpaid invoice — that is Due (amber). Red means stuck.
- **Don't** show two equal-weight buttons for a decision that has an order (pay, then claim).
- **Don't** use `Alert.alert` for feedback in the mobile app — it is a no-op on RN-web; use `confirmAction`, the
  Toast or inline text.
- **Don't** restyle many screens in one change — the UI drivers assert on visible text; migrate a screen at a time.
