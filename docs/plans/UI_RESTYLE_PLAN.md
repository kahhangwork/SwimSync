# UI restyle plan — all three apps to `DESIGN.md`

_Status: **IN PROGRESS** — written 2026-10-11 with `/plan-with-confidence`, hardened by `/plan-review` the same day. Phases 0–1 partly built (see §3)._
_BACKLOG item: Wave 9 #8, **UI/UX improvements**. Visual authority: root **`DESIGN.md`**. This file is the HOW and
the ORDER; `DESIGN.md` is the WHAT. Where they disagree, `DESIGN.md` wins and this file is fixed — **except where
`DESIGN.md` collides with a CI guard or a DB-built string (Q1 below): that is a question for the user, never a
silent win for either side.**_

---

## 0. How to pick this up (read first, every session)

1. `/session-start`, then read **this file's §3 (state)** and **§4 (the next unchecked step)**. Do not re-plan.
2. **The look is final** (§2 D1). Never reopen colour, font, logo, radius, spacing or the status scale.
3. Do the next unchecked step with the **per-screen recipe (§5)**. One screen per commit.
4. Tick it here **in the same commit** that ships it, and update §3.
5. **Stop and ask the user before adding any new package** (§2 D7) — the Geist font packages in step 1.1 are the only
   ones already approved.
6. **Every `⚠ RISK n MITIGATION` under a step is part of that step.** A step is not done, and is not ticked, until each
   of its mitigations is done or its assertion holds. Walk §11 (pre-commit gate) before every commit.
7. **Q1 — ANSWERED 2026-10-11: September is "Sept".** The product already says it everywhere — 13 DB functions through
   `sg_date_label` (migration `20261009000100`), the invoice/credit-note/package emails, en-SG `Intl` — and CI guard
   G-Sept (`scripts/check-sept.sh`, §7.302) enforces it. `DESIGN.md`'s One Date Style now reads `Sept 2026`. Weekday
   dates follow `DESIGN.md`: `Thu 8 Oct`, no comma (a display-only helper, D4).
   **Do NOT add a `// sept-ok` marker to a month a person reads, and do NOT edit or weaken `check-sept.sh`,
   `sg_date_label` or `sgDisplay.drift.test.ts`.**

---

## 1. Goal and definition of done

Every surface a person sees — coach app, parent app, admin panel, platform panel, public token pages, auth screens and
the transactional emails — follows `DESIGN.md`: neutral greys, one blue `#2563eb`, Geist, flat 1px-bordered surfaces,
the five-step status scale as words in tags, the three signature rules (Blocked-Action, Pay-First,
Blocker-Outranks-Routine), the Plain Words / Aligned Money / One Date Style rules, 44px touch targets, 12px text floor,
4.5:1 contrast.

**Done when** (all checkable, §7):
- no `sky-*`, `gray-*`, `slate-*`, `violet-*`, `indigo-*`, `purple-*`, `pink-*`, `teal-*`, `emerald-*`, `orange-*`
  Tailwind class and no legacy hex (`#0ea5e9`, `#0284c7`, `#9ca3af`, `#6b7280`, `#d1d5db`…) remains in UI code, except an
  allowlist recorded in §7;
  ⚠ RISK 10 MITIGATION — **the banned set is every Tailwind *default-palette* colour class** (`(bg|text|border|ring|
  divide|outline|fill|stroke|from|to|via|placeholder|decoration)-<palette>-<shade>`), not only the ten above: on
  2026-10-11 there are ~715 `red/amber/green/blue/neutral/yellow/…` uses that the ten-name list would wave through.
  Allowed colours are the DESIGN.md token classes plus `white` / `black` / `transparent` / `current`, and the §7
  allowlist.
  ⚠ RISK 9 MITIGATION — **`SwimSyncAdmin/lib/classColours.ts` is permanently allowlisted (tenant data, not chrome).**
  `classes.colour` stores palette KEYS (`sky`, `rose`, `violet`, `teal`, `orange`…, CHECK `^[a-z]{3,12}$`); an
  unknown key renders NEUTRAL with no error. **Do NOT rename, remove or remap any palette key or swatch in a restyle.**
- the legacy `primary-50…900` sky shades are deleted from both Tailwind configs, and the screen-local components have
  folded back into shared ones;
- Impeccable's detector reports nothing unverified; every screen in §4 is ticked;
- the drift tests (`lib/designTokens.drift.test.ts`, both apps) and the twin `statusTone` test are green.

---

## 2. Decisions (all the user's, 2026-10-11 — do not reopen)

| # | Decision |
|---|---|
| D1 | **The look is final**: direction A as written in `DESIGN.md` — tokens, Geist, blue-600, logo 2a, status scale, the three signature rules. No new options, no taste passes. |
| D2 | **Order**: 1) ship logo 2a → 2) tokens in both Tailwind configs, no screen change → 3) audit every screen + Impeccable audit, file ranked S items → 4) **one screen per change, starting with coach Schedule**. Steps 1–3 are done. |
| D3 | **Shipping — the nightly gate is relaxed for restyles.** A *visual-only* change (definition §6) may land on `main` without waiting for the next nightly, once its own `--only` drivers are green. Logic/data changes keep the gate. A red nightly freezes further restyle landings until it is triaged. |
| D4 | **Wording may change** to meet `DESIGN.md` (sentence-case headings, `Sat 26 Sept`, Plain Words) — **and every driver that asserts the old string is updated in the same commit**, proven by `--only` runs before and after. |
| D5 | **Geist is loaded in both apps.** Admin via `next/font/google` (built into Next, no package). App via **`@expo-google-fonts/geist`** (approved; `expo-font ~13.0.2` is already a dependency). |
| D6 | **Scope is everything**: every app screen, the platform panel, public token pages, auth screens, transactional emails, and retiring the legacy tokens/components at the end. |
| D7 | **Ask before any OTHER new package.** |
| D8 | **One screen per commit.** A shared primitive (tab bar, sidebar, button, tag) is its own commit and counts as one "screen". |

Decisions this plan makes (the user may overrule; none changes the look):
- **P1 — shared design-system primitives early.** New token-based primitives are added *beside* the legacy
  `Card` / `PrimaryButton` / `StatusBadge` (step 1.3); each screen migrates onto them; the legacy ones are deleted only in
  Phase 7. Screen-local copies (Schedule's `ScheduleButton` / `CARD`) fold into the primitives in step 1.3.
- **P2 — the parked status-tag branch is the status primitive.** `ui/status-scale` (`08fe3d9`) is revived in step 1.4
  rather than redone.
- **P3 — dark mode is out of scope** (`DESIGN.md` defines none; the app is light-only, pinned by `lib/darkMode.drift.test.ts`).
- **P4 (from `/plan-review`) — shared chrome never takes the relaxed gate.** Steps 1.1, 1.2, 1.6 and 7.1 change every
  screen at once, so they are never "visual-only" under §6, whatever files they touch (see ⚠ RISK 8 under each).

---

## 3. State (update in every commit that ticks a step)

_As of 2026-10-12 (evening): Phase 0 and all of 2.1 (`64ab076`, wording `7445547`) are on `main`. Steps 1.1 (Geist) and 1.2 (tab bars) landed the same evening on the user's waiver of the nightly cap. **Next: read the first nightly after them and fill the five empty "Nightly verdict" cells; then step 1.3.**_
_2026-10-13: nightly `38269313790` (dispatched by the user on `3d0672a`) read **green** — all five landings verified. 1.3 lands now, 1.4 after it, both before the 03:17 scheduled nightly. Admin type tokens become **rem** in 1.6 (user, 2026-10-12 — answers RISK 11)._

| Branch | Commit | What | Landed? |
|---|---|---|---|
| `ui/logo-2a` | `9edfee4` (+ docs `99c1f51`, `33c8156`) | Step 0.1 — logo 2a everywhere + `brand/render.mjs` | **yes**, 2026-10-11 (DEPLOYMENT #83) |
| `ui/design-tokens` | `f805461`, `f5609d4` | Step 0.2 — tokens + drift tests; BACKLOG audit filing | **yes**, 2026-10-12 (DEPLOYMENT #83) |
| `ui/restyle-plan` | `5c38056`, `cda10ac`, `e97d14f` | Step 0.3 — this plan, Q1 = "Sept", six GOTCHAS, `check-visual-only.sh`, the D3 exception in HANDOVER §9 GATE + DEPLOYMENT #84 | **yes**, 2026-10-12 |
| `ui/coach-schedule` | `64ab076` | Step 2.1 — coach Schedule restyle (words kept; "Sept"; G-Sept green). 11 Schedule drivers green `--only` 2026-10-11 after two fixes: week arrows lost their button role (a `<button disabled>` cannot be clicked past the bound), and `verify-trials` presses the visible class card (it passed on coordinate luck, §7.58). `check-visual-only.sh`: NOT VISUAL-ONLY on 3 lines — `useState` (the fold toggle) ×2, `.sort()` in `blockedMonths` (a display helper) — each must be explained in its commit message to land under D3 | **yes**, 2026-10-12 |
| `ui/status-scale` (on old `main`) | `08fe3d9` | PARKED — revived as step 1.4 on `ui/status-scale-v2` | superseded |
| `ui/status-scale-v2` (on `ui/primitives`) | (this commit) | Step 1.4 — `08fe3d9` cherry-picked (only its 15 files; BACKLOG/DESIGN conflicts resolved to `main` and rewritten), then: both `StatusBadge`s render `components/ui/Tag` (status-* tokens; the default-palette classes are gone); `statusTone.ts` twins gain `knownTone()` (own keys only) + keys for every rendered word (Open, Not billed yet, Not run yet, Nothing to bill, Approved, Declined, Withdrawn); **Outstanding = Due (amber), Overdue waits** (no due-date source — BACKLOG S7). Test: every word either app renders (enums, CHECK lists, attendance labels, `<StatusBadge>` literals — 35 words) has a decided tone. 8 drivers before (`84f7ea5`) = after, NOT FOUND 0 → 0 | yes, 2026-10-13 — before the 03:17 nightly, at the user's request |
| `ui/geist` | `85230ee` | Step 1.1 — Geist in both apps. App: `components/GeistFonts.tsx` beside the root `<Stack/>` (one family, 400/500/600 faces; reaches RN-web Text via `html [dir]` — NOT the class name, which is `css-text-<hash>` in dev but `css-<hash>` in a production build, caught at `/commit-review` and proven on a local `expo export`: computed font Geist, 3 faces loaded); admin: `next/font/google` → `--font-geist` → Tailwind `sans`. NOT VISUAL-ONLY (P4). Before → after on `a1d5a93` → `69045d9`: `app-auth` 29/29, `admin-reset-password` 18/18, `smoke-app` 71/71, `smoke-admin` 64/64, `tenant-provisioning` 15/15, NOT FOUND 0 → 0. **Full local sweep on `69045d9` (user said yes, 2026-10-12): 74/74 PASS, NOT FOUND 0** — on the dev-only class selector; the `[dir]` fix after it re-ran the five drivers above on `c3e1738`: equal scores, except one `tenant-provisioning` run at 14/15 — the new admin's sign-in still read "Signing in…" when the driver's fixed 3 s wait ended (first post-login compile after the admin `.next` was cleared; no admin file changed since `69045d9`) — 15/15 on the immediate re-run. Computed font = Geist on 3 app + 3 admin screens (1440, 1152); faces 400/500/600 loaded; admin `main` fits. Native: splash only — native `Text` does not take Geist yet (store builds out of scope) | **yes**, 2026-10-12 — the user waived the nightly cap |
| `ui/tab-bars` (on `ui/geist`) | (this commit) | Step 1.2 — coach + parent tab bars to DESIGN.md through one shared `components/TabBar.tsx` (12px labels, `#525252` / active `#0a0a0a` 600, 2px Lane Blue line at the top border, 64px + safe area, lineHeight 16 ends "Settinas"/"Billina"). No label renamed; the label stays a bare `<Text>` directly in the tab's pressable. `check-visual-only.sh`: VISUAL-ONLY on the code, but P4 → NOT under D3. The 19 app drivers that press a tab label: before (the `69045d9` sweep) = after (`86159ac`), NOT FOUND 0 → 0 (8 re-run after the Mac lid-slept mid-batch, 2026-10-12 18:33). Cover check at 390px: on all 7 tab screens (coach Schedule/Classes/Settings, parent Home/Attendance/Billing/Profile) the top screen's content or scroll viewport ends ≤ the bar's top (781px) | **yes**, 2026-10-12 — the user waived the nightly cap; no full sweep |
| `ui/primitives` | (this commit) | Step 1.3 — `components/ui/` in both apps: `Button` (primary/secondary/destructive/link; app destructive takes its `confirm` through `confirmAction`, admin's confirm is the caller's Modal), `Surface`, `Tag` (five tones), `SectionHeading` (app: muted group label; admin: Headline section title). Schedule's `ScheduleButton`/`CARD` folded in and deleted — identical classes. Found: admin `cn()` dropped `text-body` beside `text-ink` (§7.372, fixed in `lib/utils.ts`); a failing jest `toBe` on two RNTL nodes hangs (§7.373); a midnight-straddling `--only` run (§7.374). App jest now runs `components/**` tests (§7.369). 11 Schedule drivers before (`3d0672a`) = after (`9d37725` tree), NOT FOUND 0 → 0 | yes, 2026-10-13 |

⚠ RISK 3 MITIGATION — **Landing ledger** (one row per restyle landing; append, never edit):

| Step | Commit | visual-only? (`check-visual-only.sh` verdict) | `--only` drivers run | NOT FOUND before → after | Bundle string grepped | Next nightly run id | Nightly verdict |
|---|---|---|---|---|---|---|---|
| 0.1 logo | `9edfee4` | NOT VISUAL-ONLY (`app.json` splash colour) — landed under the nightly gate | (built 2026-10-11, before this ledger) | — | admin login chunk `M6 32Q13 21`; rasters byte-identical | `38182159846` | green |
| 0.2 tokens | `f805461`, `f5609d4` | VISUAL-ONLY | none — compiled CSS byte-identical | — | none possible (no visible change) | `38269313790` (dispatched by the user, 2026-10-12 23:18) | green |
| 2.1 Schedule (as built — words kept) | `64ab076` | NOT VISUAL-ONLY on 3 lines, each explained in the commit message (fold toggle `useState` ×2, `.sort()` in a display helper) — landed under D3 | 11 Schedule drivers green 2026-10-11 on the identical app tree (`schedule-week` 21/21, `trials` 16/16, `coach-schedule-roles` 28/28, `cancel-lesson` 29/29, 7 more) | not recorded (built before the ledger) | app bundle `Mark oldest lesson` | `38269313790` (dispatched by the user, 2026-10-12 23:18) | green |
| 2.1 Schedule wording (`7445547`) — `Today ·`, `Needs marking (N)`, `Coming up`, `Done`; day labels `Sat 26 Sept` via `dayHeading` + `sgDayLabel` (`formatSgDate` untouched) | `7445547` | VISUAL-ONLY | the same 10 drivers before (`64ab076`) and after: equal scores | 0 → 0 (39 → 39 presses) | app bundle `Needs marking (` | `38269313790` (dispatched by the user, 2026-10-12 23:18) | green |
| 1.1 Geist | the `load Geist` commit | NOT VISUAL-ONLY (P4; never-visual: both root layouts, package files) — landed on the **user's waiver of the nightly cap, 2026-10-12** (four unverified landings) | 5 before/after equal + full local sweep 74/74 on `69045d9` | 0 → 0 | app bundle `html [dir]{font-family:Geist`; admin `--font-geist` | `38269313790` (dispatched by the user, 2026-10-12 23:18) | green |
| 1.2 tab bars | the `mobile tab bars` commit | VISUAL-ONLY on the code; P4 (shared chrome) — landed on the **user's waiver of the nightly cap, 2026-10-12**, no full sweep | the 19 app drivers that press a tab label, equal to the `69045d9` sweep | 0 → 0 | app bundle `re-read its options` | `38269313790` (dispatched by the user, 2026-10-12 23:18) | green |
| 1.3 primitives | the `primitives` commit | NOT VISUAL-ONLY on 3 lines, each explained in the commit message (`lib/utils.ts` `cn()` token fix, `jest.config.js` testMatch, `disabled={disabled}` prop pass-through) | 11 Schedule drivers: `schedule-week` 21, `coach-schedule-roles` 28, `stale-screen` 22, `unmarked-lessons` 12, `coach-roster` 30, `bulk-setall` 10, `cancel-lesson` 29, `trials` 16, `tz-saturday` 6, `attendance-guard` 22, `smoke-app` 71 — before = after | 0 → 0 | app bundle `text-body font-semibold text-ink-muted` (the disabled label; minified prod strips `DISABLED_BOX`) | | |
| 1.4 status scale | the `status scale` commit | NOT VISUAL-ONLY (`lib/billingMonths.ts` gains `monthTone()` — reads only fields the last run stores, no query; admin Invoices shows Claimed for a claimed row) — lands under the nightly gate: the 03:17 scheduled run is its first | `invoice-admin` 33, `invoice-controls` 18, `money-admin` 44, `parent-pay-claim` 17, `payment-collection` 19, `package-draw-at-marking` 33, `smoke-admin` 64, `smoke-app` 71 — before = after | 0 → 0 | both apps: `Not run yet":"neutral` (the statusTone map; absent from prod before 1.4) | | |

**2026-10-12: the user waived the cap for 1.1 and 1.2** — five landings now await one nightly; a red one is attributed across all five rows' driver lists.

A landing whose "Nightly verdict" cell is empty is **unverified**. **Do NOT land a fourth restyle while three are
unverified** — at most three landings can be attributed per red nightly. The user may raise this cap; nobody else may.

Audit evidence (2026-10-11): 81 screenshots + four reviewer reports + Impeccable detector — summarised in BACKLOG
*UI/UX improvements* (the ranked S list and fold-ins). Screens not yet captured: §4 step 1.5.

---

## 4. The steps, in order

Tick `[x]` in the commit that ships each. **S#** = the BACKLOG ranked item it satisfies.

### Phase 0 — land what is built
⚠ RISK 12 MITIGATION (governs all of Phase 0):
- **Land in this order, one push per unit: 0.1 → 0.2 → 0.3 → (Q1 answered) → 2.1.** Each push is
  `git push <exact-branch>:main` from the root checkout. Before each push, run `git log --oneline origin/main..<branch>`
  and **assert the list is exactly the commits this unit names in §3** — anything extra is a blocker.
- Pushing `ui/logo-2a` also pushes the two unpushed `main` docs commits (`99c1f51`, `33c8156`); that is expected.
  Vercel deploys every commit of the push (§7.271), so grep the served bundle for a string **only the last commit adds**
  (`git grep -c '<string>' <previous-sha>` must print nothing).
- **Never run `run-all-drivers.sh --only …` or `supabase db reset` while a sibling worktree is running** — each
  `--only` resets the shared DB (§7.55). Check `git worktree list` first; any other worktree active → stop and ask.

- [x] **0.1** Land logo 2a (`ui/logo-2a`). Verify on prod: the favicon and the login tile show the new mark (grep the served admin bundle for `M6 32Q13 21`).
- [x] **0.2** Land tokens + drift tests + BACKLOG filing (`ui/design-tokens`). No visual change — compiled CSS proven byte-identical.
- [x] **0.3** Land **this plan** + `docs/plans/README.md` row + HANDOVER §9 pointer + the D3 gate exception (§6) written into HANDOVER's GATE line and `docs/DEPLOYMENT.md`.
  - Correct the GATE line's citation while editing it: HANDOVER's `GATE (§7.1)` mis-cites GOTCHAS §7.1 (an RLS gotcha).
    Cite it as **HANDOVER §9 GATE**.
  - ⚠ RISK 3 MITIGATION — **write `scripts/check-visual-only.sh <base> <head>` in this commit.** It classifies a change
    and prints `VISUAL-ONLY` or `NOT VISUAL-ONLY: <reason>`. It does not block anything. It prints NOT VISUAL-ONLY
    when any of these hold:
    (a) a changed path falls outside the §6 path list;
    (b) a changed path is on the **never-visual list**:
    `SwimSyncApp/app/_layout.tsx`, `SwimSyncApp/app/(auth)/**`, `SwimSyncApp/lib/**` (except a listed display helper),
    `SwimSyncAdmin/components/{AuthGuard,RequiresTenant,PermissionsProvider,Sidebar}.tsx`, `SwimSyncAdmin/lib/adminNav.ts`,
    `SwimSyncAdmin/app/(auth)/**` or the admin login/accept-invite/reset routes, the public token pages, any
    `dao/`, `supabase/**`, any `*Email*.ts`, `package.json` / lockfiles, and both Tailwind configs' `content` keys;
    (c) an added or removed line in a changed file matches
    `supabase\.|\.from\(|\.rpc\(|fetch\(|router\.(push|replace|back)|use(Effect|State|Memo|Callback|Ref|Query)\b|await |signUp|signIn|auth\.|disabled=|enabled=|\.filter\(|\.sort\(|toSgDate|todayInSg|nowMinutesInSg|Alert\.alert`
    — for a match, the commit message carries one line per match explaining it, or the change is NOT visual-only;
    (d) `.db-any-allowance` may only DECREASE.
    **Prove it (§7.25):** it must print NOT VISUAL-ONLY on `9edfee4`'s parent range for a known logic commit (pick any
    recent `feat` commit touching a `dao/`) and on a scratch diff adding `useEffect(` to a screen; VISUAL-ONLY on
    `f805461`. Record the three outputs in the commit message.
  - ⚠ RISK 3 MITIGATION — **rollback path, written into the D3 exception text:** a red nightly attributed to a
    restyle landing is reverted with `git revert <sha>` + `git push main:main` **in the same session** unless the fix
    is a one-line string. That is safe because a visual-only change carries no data. Then the screen is redone.

### Phase 1 — foundations (shared, each its own commit)
- [x] **1.1** Load **Geist** — admin `next/font/google` in `app/layout.tsx`, app `@expo-google-fonts/geist` via `useFonts` in the root `_layout.tsx` (gate the splash until loaded; fall back to system on error). Set `fontFamily.sans` to Geist in both configs **only after** both load — this IS a global visual change, so screenshot 3 screens per app before/after.
  - ⚠ RISK 1 MITIGATION — **Do NOT make `RootLayout` return `null`, a splash or anything other than `<Stack/>` while
    fonts load, and do NOT move its auth `useEffect` (the recovery/invite hash detection, `routeForSession`,
    `onAuthStateChange`) below a font-gated subtree.** That effect reads `window.location.hash` synchronously on
    first mount. `router.replace` before the navigator mounts throws. Instead:
    - put font loading in a sibling hook/component that never wraps the `<Stack/>`;
    - **on web, block nothing** — text renders in the fallback until Geist swaps in;
    - on native, `SplashScreen.preventAutoHideAsync()` + hide on `loaded || error` **or after a 3 s timeout, whichever
      comes first**.
  - ⚠ RISK 1 MITIGATION — **Assertion: `--only app-auth`, `--only admin-reset-password`, `--only smoke-app`,
    `--only smoke-admin`, `--only tenant-provisioning` pass after 1.1, with the same score as before.** Record the before
    scores first. `verify-app-auth` needs :8081 (§7.268).
  - ⚠ RISK 1 MITIGATION — **Package step:** install with `npx expo install @expo-google-fonts/geist`. **Assert
    `git diff package-lock.json` adds that one package and no other top-level package.** Any other new package → stop and
    ask (D7). Load **only the weights DESIGN.md uses** (list them from DESIGN.md before installing).
  - ⚠ RISK 1 MITIGATION — **Weight mapping is decided before `fontFamily.sans` changes.** `@expo-google-fonts`
    registers one family per weight (`Geist_600SemiBold`). So `font-semibold` on a `Geist_400Regular` element is
    synthesized bold. Choose per-weight family utilities or `@font-face` weight descriptors. **Assertion, on the served
    web app in DevTools:** for a `font-semibold` heading, its computed `fontFamily` names a family for which
    `[...document.fonts].some(f => f.family === <that family> && f.status === "loaded")` is true **and** that face is
    the 600 file.
  - ⚠ RISK 1 MITIGATION — **Assertion: the font actually reaches RN-web `Text`.** RN-web sets its own font-family on
    `Text`, so `fontFamily.sans` alone may change nothing. On 3 app screens and 3 admin screens,
    `getComputedStyle(<a body-text element>).fontFamily` starts with the Geist family name. A config edit that leaves
    this false is not done.
  - ⚠ RISK 1 MITIGATION — **Prod assertion after landing:** fetch the served font asset URL (from
    `document.fonts`/network) → HTTP 200 with a font content-type, on **both** `swimsync.sg` and `admin.swimsync.sg`.
    `output: "single"` must ship the asset.
  - ⚠ RISK 8 MITIGATION — **1.1 is NOT visual-only (P4).** It changes text metrics on every screen, so labels can clip
    and pixel-pinned drivers move (`admin-table-geometry`, §7.193). Propose the full sweep to the user and wait for a
    yes. If declined, 1.1 lands under the HANDOVER §9 GATE (read the next nightly before the next app unit).
    Screenshot 3 screens per app at 390px (app) and 1440 + 1152px (admin), before and after.
- [x] **1.2** **Mobile tab bars** (S2) — coach + parent `_layout.tsx`: 12px labels `#525252`, active Ink 600 + 2px blue indicator, 64px + safe area, fix the clipped descenders ("Settinas", "Billina").
  - ⚠ RISK 8 MITIGATION — **NOT visual-only (P4).** Do NOT rename a tab label in this commit (drivers navigate by tab
    text). **Assertion:** list every driver that presses a tab label (`grep -nE "pressByText\(page, \"(Schedule|Classes|Pay|Settings|Home|Billing|Attendance|Profile)\"" drivers/*.mjs`);
    each passes `--only` before and after, with the same NOT FOUND count. **Assertion:** no screen's last element is
    hidden behind the taller bar. On each tab's longest screen, scroll to the bottom and confirm via
    `document.elementFromPoint` that the last button's centre is that button, not the tab bar.
- [x] **1.3** **Primitives** in each app, beside the legacy ones: `Button` (primary/secondary/destructive/text-link), `Surface`/card, `Tag` (status trio), `SectionHeading`; fold Schedule's `ScheduleButton`/`CARD` into them.
  - ⚠ RISK 10 MITIGATION — **Primitives live in `components/` (app) — Do NOT put a class string in
    `SwimSyncApp/lib/`** (not scanned; purged silently, §7.191). **Do NOT build a class name by interpolation**
    (`bg-status-${tone}-bg`). Every variant is a full literal string in a `Record<Variant, string>`. **Assertion (unit
    test, both apps):** every value in each primitive's variant map is a literal containing no `${`. It reads the source
    the way `sgDisplay.drift.test.ts` does, with a vacuity check that it found the maps.
  - ⚠ RISK 10 MITIGATION — **Do NOT use `primary-50…900` anywhere — those are legacy SKY; Lane Blue is `primary` /
    `primary-hover`.** **Assertion (add to `designTokens.drift.test.ts`, both apps):** a source scan of `app/`,
    `components/`, `features/` (+ admin `lib/`) finds **zero** `-primary-[0-9]` classes. It is 0 today, so this is a
    ratchet that can only stay at 0.
  - ⚠ RISK 5 MITIGATION — **`Button` keeps `pressByText`'s shape:** the label `Text` is the **direct child** of the
    pressable element (no wrapping `View`; an icon is a sibling of the `Text`, not its parent). **Assertion:** a
    component test renders `<Button label="X" icon=…/>` and asserts the `Text` with `X` has the pressable as its parent.
  - ⚠ RISK 2 MITIGATION — `Button variant="destructive"` takes its confirm through `confirmAction`. **Do NOT use
    `Alert.alert`** (a no-op on RN-web).
  - Folding `ScheduleButton`/`CARD` in counts as a Schedule change: re-run 2.1's driver list.
- [x] **1.4** **Status scale everywhere** (S7) — rebase `ui/status-scale` onto the tokens, express its classes with `status-*` tokens, add **Due vs Overdue** (needs a due-date source — read PRD before deciding; if none exists, Outstanding = Due/amber and Overdue waits). Its admin Claimed tag and month tones come with it.
  - ⚠ RISK 2 MITIGATION — **There is no due-date source** (checked 2026-10-11: no `due_date`/`due_on` in
    `database.types.ts`, none in PRD). So **Outstanding = Due (amber); Overdue waits**, filed in BACKLOG.
    **Do NOT derive "Overdue" in the client** (month < this month, invoice age, `new Date()`, `todayInSg()` arithmetic).
    That is a business rule, not a style.
  - ⚠ RISK 2 MITIGATION — **Assertion (extend the twin `statusTone` test):** every status word the apps render is
    an **explicit key** in `TONES`. Enumerate them from `database.types.ts` enums/CHECKs for invoice, attendance,
    package, claim and trial statuses, plus every literal passed to `StatusBadge`. None may reach the neutral
    fallback by default. A later wording change (e.g. "Not Marked" → "Not marked") then fails this test instead of
    silently losing its tone.
  - ⚠ RISK 2 MITIGATION — **Assertion:** the admin `InvoiceTable`/`BillingMonthsCard` show the **same S$ amounts and
    the same month list** before and after (`--only invoice-admin`, `--only invoice-controls`, `--only money-admin`,
    `--only parent-pay-claim` green with unchanged scores). `monthTone()` reads only fields the last run already
    stores. **Do NOT add a query.**
  - ⚠ RISK 10 MITIGATION — the app's tone→class map stays in `components/StatusBadge.tsx` (as `08fe3d9` already does).
    Replace its `bg-amber-50`-style defaults with `status-*` token classes.
  - ⚠ RISK 12 MITIGATION — `08fe3d9` sits on old `main` and rewrites both `StatusBadge`s. Rebase it onto the current
    tip, then **assert `git diff <tip>..<rebased> --stat` touches only the 15 files `08fe3d9` lists.** Re-run both
    unit suites. A conflict resolved by taking "theirs" wholesale is a blocker; resolve by hand.
- [ ] **1.5** **Capture the unaudited screens** with edge functions served: public invoice + package token pages, parent Contact + Join, coach Pay (a fixture coach WITH payouts), admin reset-password / accept-invite with real tokens, calendar Week view on a lesson day. Append findings to BACKLOG fold-ins.
  - Edge runtime is NOT started by `supabase start` (§7.84). Serve all functions and assert
    `curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:54321/functions/v1/public-invoice?token=x"` is not 503.
- [ ] **1.6** **Admin shell + sidebar** (S5, P0) — stack below 800px (top bar or drawer), Ground sidebar, Selected fill + `aria-current`, count badges in their status colour (S8's badge half).
  - ⚠ RISK 8 MITIGATION — **NOT visual-only (P4; `Sidebar.tsx` reads data and renders from `lib/adminNav.ts`).**
    **Do NOT change which nav items render for which role** — the item list still comes from `lib/adminNav.ts` NAV
    filtered by the same area check. **Assertion:** `--only roles`, `--only front-desk-role`, `--only platform-admin`,
    `--only platform-admin-scope`, `--only tenant-admin`, `--only smoke-admin`, `--only admin-table-geometry` pass with
    unchanged scores. At 1440px every driver that clicks a sidebar link still finds it; below 800px the drawer opens with
    one press and lists the same items (assert the item count equals the 1440px count for one role of each kind).
  - ⚠ RISK 11 MITIGATION — **The admin auto-scales its root font 16→13px below 1536px (§7.193) while DESIGN.md tokens
    are px.** Before 1.6 lands, **ask the user** whether admin `fontSize` tokens should stay px (fixed) or become rem
    (scale with the shell). That is an implementation question, not a look change. **Assertion for every admin step
    from here on:** screenshots at 1440, 1280 and 1152px; on table screens
    `document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth`.
  - Propose the full sweep to the user and wait. If declined, 1.6 lands under the HANDOVER §9 GATE.

### Phase 2 — coach app (one screen per commit)
- [x] **2.1** Schedule (S1) — _restyle landed 2026-10-12 (`64ab076`); wording on `ui/schedule-wording`_; on landing, switch headings to sentence case and dates to `Sat 26 Sept` with driver updates (D4).
  - ⚠ RISK 6 MITIGATION — **Before committing the built branch:** `scripts/check-sept.sh` exits 1 on
    `scheduleFormat.ts:22`. Until Q1 is answered, `blockedMonths` spells September **"Sept"**. Change `MONTHS`, its
    comment, and the three `scheduleFormat.test.ts` expectations ("Sep", "Sep and Oct", "Aug, Sep and Oct", and the
    `not.toContain("Sept")` case) to "Sept". **Assertion: `scripts/check-sept.sh` exits 0.**
  - ⚠ RISK 6 MITIGATION — **Split 2.1 into two commits.** (a) The restyle as built, wording unchanged. It lands under
    the relaxed gate if `check-visual-only.sh` agrees. (b) The sentence-case + date-style change, **only after Q1 is
    answered**. **Do NOT change `formatSgDate` / `formatSgStamp` output** — that changes every date on every screen in
    one commit. A new date shape (`Sat 26 Sept`, no comma) is a **new display-only helper** in each app plus a matching
    `sgDayLabel()` in `drivers/lib.mjs`, both unit-tested. It is used only on the screen being migrated. **Do NOT
    touch `toSgDate`, `todayInSg`, `parseDate`** (§7.229).
  - ⚠ RISK 5 MITIGATION — 2.1(b) touches about **65 driver references** to `TODAY ·` / `NEEDS MARKING` /
    `Needs marking` (count on 2026-10-11). **Assertion:** `grep -c` of the old strings across `drivers/*.mjs` goes from
    the recorded count to **0**, and of the new strings from 0 to the same count — a mismatch means a driver was missed
    or double-edited. Rewrite each case-sensitive regex as the new literal. **Do NOT loosen any to `/…/i` + `.*`**, which
    would match the mounted screen underneath (§7.10, §7.98).
  - ⚠ RISK 2 MITIGATION — `TodaySection`'s new `blockerShown` prop changes only which button is primary. **Assertion:
    with NEEDS MARKING showing, every Today lesson's Mark button still renders and still opens attendance** — `--only
    coach-marking`, `--only unmarked-lessons`, `--only attendance-guard`, `--only schedule-week`, `--only stale-screen`,
    `--only coach-schedule-roles`, `--only tz-saturday` (plus the rest of the 14 drivers that reference `/schedule`)
    green with unchanged scores.
  - The `.db-any-allowance` line removal (ProgressChip no longer needs an `any`) is a ratchet DOWN. G6 allows it;
    `G6_BASE=HEAD scripts/check-db-any.sh` passes.
- [ ] **2.2** Mark attendance — bottom action area (Set all + Save), chosen status as a tag, "Not marked" Warning.
  - ⚠ RISK 2 MITIGATION — **This screen produces the data billing blocks on.** **Do NOT change what Save or Set all
    writes, or when Save is enabled** (`check-visual-only.sh` must not flag `disabled=`). **Assertion:** `--only
    coach-marking`, `--only bulk-setall`, `--only attendance-guard`, `--only package-draw-at-marking`, `--only
    unmarked-lessons`, `--only lesson-detail-guests` pass with unchanged scores. If "Not Marked" becomes "Not marked",
    the 1.4 `statusTone` test must stay green (add the new key; the tone must be `warning`).
  - ⚠ RISK 8 MITIGATION — a fixed bottom action area must not sit under the tab bar or under the stale screen (§7.58).
    **Assertion:** `document.elementFromPoint(<Save centre>)` is the Save button at 390×844.
- [ ] **2.3** Classes ("1 students" plural; count as text, not a pill) · [ ] **2.4** Roster (Skills vs Remove; destructive styling; one empty state) · [ ] **2.5** Grade · [ ] **2.6** Pay · [ ] **2.7** Settings (+ PayNow QR card) · [ ] **2.8** Change password.
  - ⚠ RISK 2 MITIGATION (2.4) — Remove keeps its existing confirm path. **Do NOT introduce `Alert.alert`**; `--only
    coach-remove-student`, `--only coach-roster` green.
  - ⚠ RISK 2 MITIGATION (2.6) — Pay shows coach wages. **Assertion:** `--only coach-wages` shows the same S$ figures.
    Do NOT recompute a total in the UI.
  - ⚠ RISK 4 MITIGATION (2.8) — **Change password is auth: NOT visual-only.** `--only app-coach-settings`, `--only
    app-auth` green; it lands under the HANDOVER §9 GATE.

### Phase 3 — parent app
⚠ RISK 2 MITIGATION (governs 3.1–3.9) — **Pay-First rearranges amounts; it never recomputes them.** Each "N lessons /
Credit / To pay" figure is read from a field the screen already reads, unchanged. **Do NOT add arithmetic on money in
the UI** (`check-visual-only.sh` flags any new `.reduce(`, `+`/`-` on an amount, or a new `.filter(`, and
explains it or marks NOT visual-only). **Assertion:** `--only app-money`, `--only parent-pay-claim`, `--only
payment-collection`, `--only paynow-fallback`, `--only packages`, `--only single-child-packages`, `--only parent-claim`
show identical S$ strings before and after. Diff the logs' amount lines.
- [ ] **3.1** Billing → Invoices card (S3) — Pay-First, "N lessons / Credit / To pay", Due amber, Claimed Info tag.
- [ ] **3.2** Invoice detail (S6) — same, plus the **empty Lesson Breakdown** (rows or an explicit empty line — check whether this is a data bug first; if so it is NOT visual-only, §6).
  - ⚠ RISK 13 MITIGATION — **First step of 3.2:** query the local DB for the fixture invoice's `invoice_items` (and
    one prod invoice via `scripts/prod-query-ro.sh`). Rows exist but the screen shows none → **data/query bug: file it
    in BACKLOG and leave the breakdown as-is in this commit** (§9). No rows → the explicit empty line is visual-only.
    **Do NOT change the screen's query in the restyle commit.**
- [ ] **3.3** PayNow screen · [ ] **3.4** Home (red "Outstanding Payment" banner → Warning; one tag per child card) · [ ] **3.5** Child profile (red S$0.00) · [ ] **3.6** Add / Edit child (date picker for DOB — check for a picker that needs no new package; else ask, D7) · [ ] **3.7** Attendance (44px filter chips) · [ ] **3.8** Billing → Packages · [ ] **3.9** Billing → Credit notes · [ ] **3.10** Profile / Contact / Join / Change password.
  - ⚠ RISK 13 MITIGATION (3.6) — a DOB picker is **data entry: NOT visual-only.** The stored value stays the same
    `YYYY-MM-DD` the current field writes (built from the picked parts, never `toISOString().split("T")[0]`, §7.7).
    `--only edit-child`, `--only student-identity` green. HANDOVER §9 GATE.
  - ⚠ RISK 2 MITIGATION (3.4) — the banner's show/hide condition is unchanged; only its tone changes.
  - ⚠ RISK 4 MITIGATION (3.10) — Join (join code) and Change password are entry/auth paths: **NOT visual-only**; `--only
    join-code`, `--only contact-details`, `--only app-auth` green.

### Phase 4 — auth + public
⚠ RISK 4 MITIGATION (governs all of Phase 4) — **Every Phase 4 step is NOT visual-only (P4; on the never-visual list)
and lands under the HANDOVER §9 GATE.** **Do NOT touch `signUp`/`signIn`/`resetPasswordForEmail`/`updateUser` calls,
the options or metadata they pass, `lib/publicRoutes.ts`, `lib/staffInvitation.ts`, or any redirect** (§7.289 — a
role from sign-up metadata made anyone a platform admin). **Assertion:** `check-visual-only.sh`'s match list for the
commit contains no `auth.`/`signUp`/`signIn`/`router.` line. **Assertion per step:** the step's drivers pass with
unchanged scores — app: `app-auth`, `smoke-app`, `join-code`, `trial-onboarding`; admin: `admin-reset-password`,
`admins`, `smoke-admin`, `tenant-provisioning`; public: `payment-collection`, `paynow-fallback`, `packages`. Then a
**prod hand-check right after landing**: sign in as each seed role on swimsync.sg and admin.swimsync.sg, request a reset
email to your own address and complete it, and open one live public invoice link.
**Rollback:** any failure → `git revert` + push in the same session (§6).
- [ ] **4.1** Welcome · [ ] **4.2** Login · [ ] **4.3** Register · [ ] **4.4** Forgot / Reset / Accept-invite (app) · [ ] **4.5** Public invoice token page (+ the bad-token dead end) · [ ] **4.6** Public package token page · [ ] **4.7** Admin login / forgot / reset / accept-invite.
  - ⚠ RISK 4 MITIGATION (4.5, 4.6) — the public pages are reached signed-out from WhatsApp. **Assertion:** with edge
    functions served (§7.84), a valid token renders the amount and PayNow details, and a bad token renders the dead-end
    copy. Check both **signed out and signed in as another parent** (`onPublicRoute` must keep the page).

### Phase 5 — admin panel (billing first, then operations)
⚠ RISK 11 MITIGATION (governs all of Phase 5) — screenshots at 1440, 1280, 1152 and 390px. The `main` overflow
assertion from 1.6 holds on every table screen. Driver geometry is asserted in rem (§7.193). Driver header regexes
are case-insensitive or read `textContent` (§7.362).
- [ ] **5.1** Invoices (S4 — Generate disabled with the reason; S10 — move PayNow + auto-generation settings off the Generate card; Pending charges; Billing months) · [ ] **5.2** Credit notes (minus, Ink, one inline action, clipped column) · [ ] **5.3** Packages (one primary per section; Awaiting confirmation → Info) · [ ] **5.4** Wages · [ ] **5.5** Referrals · [ ] **5.6** Accounting.
  - ⚠ RISK 2 MITIGATION (5.1, S4) — **"Generate disabled with the reason" shows a reason the page already has; it
    never adds a new client-side precondition.** If the existing button is enabled today in a state the server then
    refuses, the restyle keeps it enabled and shows the server's refusal. **Do NOT add a client check that can disable
    Generate when the server would accept.** That blocks a tenant from billing with no recourse. **Do NOT add any
    override** to the unmarked-attendance block or the completed-month guard (CLAUDE.md). **5.1 is NOT visual-only if
    the enabled condition changes at all.** **Assertion:** `--only invoice-controls`, `--only invoice-admin`, `--only
    unmarked-lessons`, `--only orphan-report`, `--only money-admin`, `--only accounting-packages` pass with unchanged
    scores. In a hand-check the Generate button is enabled in the fixture's billable month.
  - ⚠ RISK 2 MITIGATION (5.1, S10) — moving the PayNow / auto-generation settings is a **move, not a rewrite**. The
    save handlers and the fields they write stay byte-identical (`git diff -M` shows the handler moved unchanged).
    `--only tenant-branding`, `--only paynow-fallback` green.
- [ ] **5.7** Lessons (S8 — past unmarked = Danger "Blocks billing"; one count with the sidebar) · [ ] **5.8** Dashboard · [ ] **5.9** Students · [ ] **5.10** Classes · [ ] **5.11** Calendar (remove `border-l-4` side-tabs; legend ≥12px) · [ ] **5.12** Attendance log · [ ] **5.13** Assessment · [ ] **5.14** Unassigned · [ ] **5.15** Parent requests (claims) · [ ] **5.16** Parents · [ ] **5.17** Coaches · [ ] **5.18** Trials · [ ] **5.19** Make-ups · [ ] **5.20** Substitutes · [ ] **5.21** Holidays · [ ] **5.22** Levels · [ ] **5.23** Locations · [ ] **5.24** Admins · [ ] **5.25** Roles · [ ] **5.26** Change history · [ ] **5.27** Lesson detail (`/lessons/[classId]/[date]`) · [ ] **5.28** Assessment class (`/assessment/[classId]`).
  - ⚠ RISK 2 MITIGATION (5.7) — "Blocks billing" labels the rows the page **already** counts as past-unmarked.
    "One count with the sidebar" means both read the **same existing source**. **Assertion:** the Lessons count equals
    the sidebar badge equals the count the billing guard reports for the fixture (`--only unmarked-lessons`, `--only
    admin-lesson-nav`). Do NOT write a second counting query.
  - ⚠ RISK 9 MITIGATION (5.11) — the Calendar may change how a class colour is **applied** (e.g. drop `border-l-4`),
    never the palette. **Assertion (unit test in `classColours.test.ts`, add if absent):** the twelve keys are present
    and their `card`/`dot` classes are distinct. Every key in prod `select distinct colour from classes`
    (`scripts/prod-query-ro.sh`) resolves to a non-neutral swatch. `--only admin-calendar`, `--only class-edit` green.
  - ⚠ RISK 8 MITIGATION (5.24, 5.25) — Admins and Roles grant access. The role/area pickers keep the same values;
    `--only admins`, `--only roles`, `--only front-desk-role` green. **NOT visual-only if any handler line moves.**
- [ ] **5.29** Platform panel (`/platform`).
  - ⚠ RISK 4 MITIGATION — cross-tenant: `--only platform-admin`, `--only platform-admin-scope`, `--only
    platform-controls`, `--only tenant-suspension` green; suspend/unsuspend handlers untouched.
- S9 (one date style in admin tables) is done screen by screen inside 5.x, through `formatSgStamp`.
  - ⚠ RISK 13 MITIGATION — **Only the rendered cell changes.** A date used to **sort, filter, compare, key a row
    or build a URL** keeps its current value (often `toSgDate`, compared lexically — 34 call sites, §7.229). **Do NOT
    pass a `formatSgStamp` result into a sort, filter, comparison or key**, and **do NOT "harden" `toSgDate`**.
    **Assertion:** in each 5.x diff every `formatSgStamp(` added is inside JSX text, never in a `.sort(`/`.filter(`/
    `key=`/`href=` expression (`check-visual-only.sh` flags `.sort(`/`.filter(`).

### Phase 6 — emails
⚠ RISK 7 MITIGATION (governs all of Phase 6):
- **Emails do not go out on a git push.** `generate-invoices`, `credit-note-emails`, `package-emails` deploy by
  `supabase functions deploy <name>`, one at a time. The admin `lib/*Email.ts` go out with the Vercel push.
- **Before deploying an edge function:** on a clean tree run `supabase functions download <name>` and **assert
  `git diff <previous landed sha> -- supabase/functions/<name>/` shows only the email file and its test** (§7.187). Any
  engine change (`core.ts`, `index.ts`, `dates.ts`, …) pending in the same function → stop; it is not an email
  restyle. After deploying: `supabase functions list` shows the version bumped, and `functions download` →
  `git status` clean.
- **Do NOT deploy `generate-invoices` while an admin may be running a billing month.** Billing is manual (no cron).
  Check `scripts/prod-query-ro.sh` for no run started in the last hour, and avoid the 1st–3rd of the month.
- **Run `supabase/functions/generate-invoices/test.sh` twice** (§7.15); both green.
- **Assertion (add to each email's test):** the rendered HTML, for every variant (with/without tenant logo, with
  claim, with credit, zero lines), contains the amount, the pay link and the tenant name. It contains **no**
  `var(`, `display:flex`, `display:grid`, `<link`, `@font-face`, `@import`, `<style` (inline CSS only, email-safe).
  Every `font-family` starts with `Geist,` and ends with a system fallback — Geist will not load in mail clients.
  The invoice email shows the **tenant's** logo/name, never SwimSync's (`brand/README.md`).
- **Do NOT let a render error be swallowed silently.** The invoice email is best-effort. The test above is the guard,
  so it must be proven red against a deliberately broken template once (§7.25).
- **Send one real test email per template to your own inbox** (Gmail web + one Outlook client) before ticking.
- [ ] **6.1** Invoice email (`supabase/functions/generate-invoices/email.ts`) · [ ] **6.2** Credit-note email · [ ] **6.3** Package emails · [ ] **6.4** Admin-sent invites (`SwimSyncAdmin/lib/inviteEmail.ts`, `parentInviteEmail.ts`, `coAdminInviteEmail.ts`, `creditNoteEmail.ts`) · [ ] **6.5** Supabase auth templates (`supabase/templates/recovery.html`, `confirmation.html`).
- Constraints that already exist: the invoice email is headed by the **tenant's** logo and name, never SwimSync's (`brand/README.md`); recovery stays a **text** wordmark (no SVG/hosted PNG); colours only — inline CSS, email-safe. **Edge-function emails deploy with `supabase functions deploy <name>`, one at a time — a git push does not deploy them**; auth templates need the dashboard / config push per `docs/DEPLOYMENT.md`.
  - ⚠ RISK 7 MITIGATION (6.5) — **Do NOT run `supabase config push`.** It carries the whole local auth config,
    including the confirmations toggle that stranded web parents (§7.232). Auth templates go in **by dashboard paste
    only**. **Assertion after the paste:** `curl -s https://<ref>.supabase.co/auth/v1/settings -H "apikey: <anon>"`
    still shows `"mailer_autoconfirm": true`. Send yourself a real reset email from prod and complete it.
    `confirmation.html` is dormant. State "rendered offline only, never sent" in the commit message (§7.232).
  - ⚠ RISK 7 MITIGATION (6.4) — the invite email IS the deliverable. `inviteEmail.test.ts`, `parentInviteEmail.test.ts`,
    `coAdminInviteEmail.test.ts` green, with the same assertion set as above. `--only admins`, `--only
    tenant-provisioning` green.

### Phase 7 — retire the legacy
- [ ] **7.1** Delete legacy `Card`, `PrimaryButton`, `StatusBadge` (both apps) once no importer remains; delete the `primary-50…900` sky shades from both configs; add a CI guard (a drift-test assertion) that the banned classes in §1 do not reappear outside the §7 allowlist.
  - ⚠ RISK 10 MITIGATION — Tailwind drops an unknown class silently. **Before deleting a config shade or a component,
    assert zero uses:** `grep -rEn '\-primary-[0-9]{2,3}\b'` across `app/ components/ features/ lib/` of both apps prints
    nothing, and `tsc` proves no importer. **The guard is a test, not a note:** it fails on any §1 banned class (the widened
    default-palette set) outside the allowlist. **Prove it red** by adding one `bg-sky-500` to a scratch screen (§7.25).
    Include a vacuity check that the scanner saw >100 files.
  - ⚠ RISK 8 MITIGATION — **NOT visual-only (P4)** if any screen changes as a result. If the greps above are empty, the
    change is config + dead code; still propose the full sweep to the user once, as Phase 7 closes.
- [ ] **7.2** Re-run the full audit (capture script + Impeccable detector + `/impeccable audit`) and record the score in this file.
- [ ] **7.3** Update `DESIGN.md` status ("adopted"), PRD where screens changed behaviour, BACKLOG (delete the item), HANDOVER.
  - Fix DESIGN.md's One Date Style examples to match Q1's answer, so the doc and G-Sept stop disagreeing.

---

## 5. Per-screen recipe (every step in Phases 2–5)

1. **Read** the screen's audit findings (BACKLOG *UI/UX improvements* — ranked item and fold-ins) and `DESIGN.md`.
2. **Inventory the drivers** that touch it: `grep -n` the screen's visible strings and `testID`s across
   `.claude/skills/run-ui-playwright/drivers/*.mjs` (and `lib.mjs` helpers like `pressByText`, `pressClassButton`). List
   every string a driver asserts or presses BEFORE editing.
   - ⚠ RISK 5 MITIGATION — **also grep** the app's jest tests (`getByText`, `toHaveTextContent`), the admin vitest
     tests, the Deno email tests and the fixture SQL. A changed string they assert is updated in the same commit.
   - ⚠ RISK 5 MITIGATION — **Record the baseline:** for each listed driver,
     `RUN_DIR=<scratch>/before-<d> run-all-drivers.sh --only <d>` on the commit BEFORE the change. Write down its score
     and `grep -c "(NOT FOUND)" <scratch>/before-<d>/<d>.log`. Fifty bare `await pressByText(` calls ignore a miss,
     so a renamed button is silently never pressed.
   - ⚠ RISK 8 MITIGATION — **If the list exceeds 15 drivers** (shared chrome, a primitive many screens use), the change
     is effectively global. Propose the full sweep to the user and wait. If declined, the change keeps the HANDOVER §9
     GATE.
3. **Restyle with tokens only** (`DESIGN.md` → *Tokens as Tailwind classes*). No raw hex in className; an icon colour
   prop may use the token's hex. Keep `testID`s and element nesting that `pressByText` relies on (it dispatches on the
   leaf's **parent**).
   - ⚠ RISK 10 MITIGATION — **Do NOT write `primary-<shade>`** (legacy sky). **Do NOT write a default-palette class**
     (`red-*`, `amber-*`, `blue-*`, …) — use `status-*` / `ink-*` / `border-*` tokens. **Do NOT interpolate a class
     name.** **Do NOT place a class string in `SwimSyncApp/lib/`.**
   - ⚠ RISK 9 MITIGATION — **Do NOT edit `SwimSyncAdmin/lib/classColours.ts`.**
4. **Words**: change them to `DESIGN.md` where the audit says so (D4), and update each driver from step 2 in the same
   commit.
   - ⚠ RISK 5 MITIGATION — a driver's new string is the **exact new literal**. A heading styled `uppercase` is matched
     case-insensitively or via `textContent` (§7.362). A date in a driver comes from `lib.mjs` (`sgLabel()` or the
     2.1(b) helper), never a hand-typed date or `toLocale*` (`check-driver-dates.sh`). **Do NOT widen a regex to make
     it pass.**
   - ⚠ RISK 5 MITIGATION — **Prove the updated driver bites (§7.25):** run it once against the **old** build (stash the
     screen change, keep the driver change). It must FAIL on the changed string. Record the failing line.
   - ⚠ RISK 2 MITIGATION — a renamed **status word** gets its new key in `TONES` (both twins) in the same commit; the
     1.4 statusTone test stays green.
   - ⚠ RISK 6 MITIGATION — never "Sep" (Q1 answered: "Sept"); `scripts/check-sept.sh` exits 0.
5. **Verify**: typecheck + both unit suites; a before/after screenshot at 390px (app) or 1440px + 390px (admin);
   Impeccable `detect` on the changed files; every driver from step 2 with `run-all-drivers.sh --only <d>` (edge functions
   served; Expo started without `CI=1`; the served bundle grepped for a new string first).
   - Admin also at **1280 + 1152px** (⚠ RISK 11).
   - ⚠ RISK 5 MITIGATION — **Assertion:** each driver's score after ≥ before. Its `(NOT FOUND)` count after ≤ before;
     a rise means a press silently missed.
   - ⚠ RISK 3 MITIGATION — drivers run on a **clean tree at the commit being landed** (`git status --porcelain` empty;
     record `git rev-parse HEAD` in the §3 ledger). The served bundle is fetched with `lazy=false` for coach screens
     (§7.253) and grepped for a string from this change.
   - ⚠ RISK 12 MITIGATION — `git worktree list` shows no active sibling before the first `--only` (each one resets the
     shared DB).
6. **Commit** via `/commit-review`; tick the step here; push per §6.

---

## 6. Landing a restyle — the relaxed gate (D3)

A change is **visual-only** when ALL hold:
- it touches only UI files — `app/**` screen/route files, `features/**/ui/**`, `components/**`, Tailwind config, brand
  assets — plus driver strings and tests;
- no `dao/`, `domain/` hook logic, `lib/` logic, migration, edge function, RPC or query changes — **except** pure
  display helpers (formatters, label/tone maps) with their unit tests;
- the screen's `--only` drivers (§5 step 2) passed on this exact commit.
- ⚠ RISK 3 MITIGATION — **and** `scripts/check-visual-only.sh origin/main HEAD` prints `VISUAL-ONLY`, or every
  pattern match it lists is explained by one line in the commit message. The **never-visual list** in that script
  (app `_layout.tsx` and `(auth)`, admin `AuthGuard` / `RequiresTenant` / `PermissionsProvider` / `Sidebar` /
  `lib/adminNav.ts`, auth routes, public token pages, emails, Tailwind `content`, package files) overrides the path
  list above. Those live under "UI" paths but hold access logic.
- ⚠ RISK 8 MITIGATION — **and** it is not a P4 step (1.1, 1.2, 1.6, 7.1) and not a Phase 4 step, and its §5 step 2
  driver list is ≤15.

A visual-only change lands without waiting for the next nightly. **Anything else keeps the HANDOVER §9 gate**
(read the next nightly before the next app unit merges). After any landing, read the next nightly anyway; **a red one
freezes restyle landings** until triaged per `docs/TESTING.md` §5. Each landing: `git push <branch>:main`, then grep the
served bundle for a string only the new build has (`docs/DEPLOYMENT.md` §11) — a 200 proves nothing.
- ⚠ RISK 3 MITIGATION — add the landing's row to the §3 ledger in the same commit. **At most three unverified landings
  at once.** On a red nightly: map each red driver to the ledger's driver lists; **revert** the attributed landing
  (`git revert <sha>`, push) in the same session unless the fix is a one-line string. Never dispatch or re-run the
  nightly yourself — read it.
- ⚠ RISK 3 MITIGATION — **before every push, run the `repo-invariants` steps of `.github/workflows/ci.yml` locally**
  (§7.354). CI runs after Vercel has deployed.

---

## 7. Verification

- **Per step**: §5 step 5.
- **Allowlist** (classes/hex that may stay after Phase 7): `#2563eb` and other token hexes in icon colour props; status
  dots (`rounded-full`, 8px) — extend only with a one-line reason here.
  - `SwimSyncAdmin/lib/classColours.ts` — the class colour palette is tenant data (`classes.colour` keys), never
    restyled (⚠ RISK 9).
- **Global**: Phase 7.1's guard; the drift tests; a final full capture compared with the 2026-10-11 audit set.

---

## 8. Risks

Ranked by `/plan-review` on 2026-10-11. **Every mitigation lives inline as `⚠ RISK n MITIGATION` under the step it
governs**, and §11 is the gate. This is an index, not the content:

| # | Risk | Where its mitigations live |
|---|---|---|
| 1 | Geist in the root layout breaks auth routing / blanks the app | 1.1 |
| 2 | Money and status meaning on billing screens | 1.3, 1.4, 2.1, 2.2, 2.4, 2.6, Phase 3 head, 3.4, 5.1, 5.7, §5.4 |
| 3 | "Visual-only" is path-based; no attribution or rollback | 0.3, §3 ledger, §5.5, §6 |
| 4 | Auth and public token screens | 2.8, 3.10, Phase 4 head, 4.5/4.6, 5.29 |
| 5 | Driver updates that pass without testing | 1.3, 2.1, §5.2, §5.4, §5.5 |
| 6 | "Sep" vs "Sept" (G-Sept red on the built branch) | §0 Q1, §3, 2.1, §5.4, 7.3 |
| 7 | Email redeploys, swallowed failures, `config push` | Phase 6 head, 6.4, 6.5 |
| 8 | Shared chrome counted as "one screen" | P4, 1.1, 1.2, 1.6, 2.2, 5.24/5.25, 7.1, §5.2, §6 |
| 9 | Class colour palette is tenant data | §1, 5.11, §5.3, §7 |
| 10 | Tailwind purge and token-name traps | §1, 1.3, 1.4, 7.1, §5.3 |
| 11 | Admin rem auto-scaling vs px tokens | 1.6, Phase 5 head, §5.5 |
| 12 | Stacked-branch landing order; shared DB | Phase 0 head, 1.4, §5.5 |
| 13 | Date/data fixes hidden in a restyle | 3.2, 3.6, S9 under Phase 5 |

---

## 9. Out of scope

Dark mode · native store builds · new features or behaviour changes (a restyle that discovers a bug files it; it does
not fix it inside a visual-only commit) · the BACKLOG items outside *UI/UX improvements*.

---

## 10. Accepted consequences

_None yet._

---

## 11. Pre-commit gate (walk before EVERY restyle commit — a box that cannot be ticked is a blocker)

**The five that matter most:**
- [ ] `scripts/check-visual-only.sh origin/main HEAD` run. Its verdict is in the §3 ledger. NOT VISUAL-ONLY, a P4
      step or a Phase 4 step → this lands under the HANDOVER §9 GATE, not the relaxed one. (RISK 3, 4, 8)
- [ ] No auth call, redirect, query, `disabled=` condition, money arithmetic or `.sort`/`.filter` key changed. If one
      did, it is explained in the commit message and the change is not visual-only. (RISK 1, 2, 4, 13)
- [ ] Every driver from §5 step 2 ran `--only` on this exact clean commit: score ≥ before, `(NOT FOUND)` ≤ before, and
      each driver whose string changed was proven to FAIL against the old build. (RISK 5)
- [ ] All `repo-invariants` steps of `ci.yml` pass locally, in particular `scripts/check-sept.sh` (exit 0),
      `scripts/check-apps-sg-date.sh`, `G6_BASE=origin/main scripts/check-db-any.sh`, and
      `drivers/check-driver-dates.sh` / `check-driver-clock.sh` / `check-driver-ports.sh` when a driver changed.
      (RISK 6, §7.354)
- [ ] After the push: the served bundle (both apps if both changed; `lazy=false` for coach screens) contains a string
      only this commit adds; for an edge-function email, `functions list` shows the version bumped and `functions
      download` leaves `git status` clean. (RISK 3, 7)

**The rest:**
- [ ] `npm run typecheck` + `npm test` green in both apps; test counts not lower than before.
- [ ] No class string in `SwimSyncApp/lib/`; no interpolated class names; no `primary-<shade>`; no default-palette
      class; `classColours.ts` untouched. (RISK 9, 10)
- [ ] A renamed status word has its `TONES` key in both twins; the statusTone test is green. (RISK 2)
- [ ] Before/after screenshots: 390px (app); 1440 + 1280 + 1152 + 390px (admin); admin table `main` does not
      overflow. (RISK 11)
- [ ] `git log origin/main..<branch>` lists exactly this unit's commits; no sibling worktree running during
      `--only`. (RISK 12)
- [ ] Phase 6: function diff is email-only; Deno suite run twice; template assertions green; real test email
      received; no `config push`; `mailer_autoconfirm` still `true`. (RISK 7)
- [ ] Phase 4 / P4 / >15-driver steps: the full sweep was proposed to the user, OR the step is recorded as gated
      on the next nightly. Never dispatch the nightly or run the full sweep unasked.
- [ ] §3 state and ledger updated; the step ticked in this same commit.
