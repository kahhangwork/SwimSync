# SGT-correct date display, both apps

_Plan written 2026-08-30. Reviewed by `/plan-review` (fable) the same day; the six ranked risks
are folded in below as `⚠ RISK n MITIGATION`, each beside the step it governs. There is
deliberately **no trailing Risks section** — a risk read once at planning time and never again
is not a mitigation._

**Source:** `BACKLOG.md` → *"Ten `timestamptz` columns still render in the DEVICE's timezone,
not Singapore's"* (**S**), raised by the §7.227 audit and deliberately left out of that fix's
scope. This plan **widens** that item to `SwimSyncApp`'s sibling family, and **narrows** its
companion item (the `toSgDate` throw) to a strictly display-only wrapper — see Step 0.

**Predecessor:** §8.96 / §7.227, the assessment-round boundary. Same axis, display surface.

---

## 1. The problem

A `timestamptz` is an *instant*. `new Date(col).toLocaleDateString("en-SG")` with no `timeZone`
converts it into **the viewer's** calendar, not Singapore's. Anything stamped between 00:00 and
08:00 SGT renders as the previous day west of Singapore. Measured, one instant, five zones:

```
stored: 2026-08-30T02:15:00+08:00   (2:15am Sat 30 Aug SGT)

Asia/Singapore    30/08/2026      Europe/London     29/08/2026   ← wrong
America/New_York  29/08/2026      Pacific/Midway    29/08/2026   ← wrong
Pacific/Auckland  30/08/2026
```

**Latent, not live.** Every prod user is in Singapore, so nobody sees a wrong date today. It
becomes real the first time an admin works from another timezone — a trip, a remote hire, a
laptop with the wrong TZ. **`expires_at` on a referral reward is the one that costs money**: a
day's difference there is a person's deadline, not a label.

### The second family

`SwimSyncApp` has the sibling defect on **date strings**: `new Date("2026-08-30")` is UTC
midnight, which `toLocaleDateString` renders as **29 Aug** west of Greenwich. `formatSgDate`'s
own docblock names this ("Callers cannot opt out of that"). Different input, same wrong day.

### One fix shape covers both

Verified across five zones: `formatSgDate(todayInSg(new Date(x)))` is correct for a full
`timestamptz` **and** for a bare `"YYYY-MM-DD"` — the date string round-trips because UTC
midnight is 08:00 SGT the same day, and Singapore is east of Greenwich so it never wraps back.

| input | Singapore | London | New York | Midway | Auckland |
|---|---|---|---|---|---|
| `"2026-08-30"` | 2026-08-30 | 2026-08-30 | 2026-08-30 | 2026-08-30 | 2026-08-30 |
| `"2026-08-30T02:15+08:00"` | 2026-08-30 | 2026-08-30 | 2026-08-30 | 2026-08-30 | 2026-08-30 |
| `"2026-08-30T23:59+08:00"` | 2026-08-30 | 2026-08-30 | 2026-08-30 | 2026-08-30 | 2026-08-30 |

### Decisions settled with the user

| Decision | Answer |
|---|---|
| Output format | **Byte-identical to today** — `30/08/2026`. A bug fix, not a redesign |
| Scope | Both apps: admin's 10 `timestamptz` sites **and** SwimSyncApp's 5 `formatDate` helpers |
| `expires_at` | Date only, same as its neighbours. The DB already enforces the true instant |

---

## 2. Step 0 — A display-only wrapper. **Do NOT change `toSgDate`.**

> **⚠ RISK 1 MITIGATION — `toSgDate` is a LOGIC primitive, and making it degrade would turn a
> loud crash into a silently wrong answer in billing-adjacent code.** This is the
> highest-blast-radius finding in the review, and it **reversed** this plan's original Step 0.
>
> The first draft proposed making `toSgDate` return its raw input on an unparseable value
> instead of throwing. Verified: `toSgDate` has **34 call sites**, and they are overwhelmingly
> *logic*, not display —
> - `SwimSyncApp/lib/attendanceCompleteness.ts` converts `enrolled_at`/`unenrolled_at` and
>   compares them **lexically**. That computes the coach's unmarked-attendance backlog — the
>   affordance that keeps a billing month from being silently blocked.
> - `SwimSyncAdmin/lib/classCoverage.ts:122,123,143,163` builds `from`/`until` bounds.
> - `SwimSyncAdmin/components/AssessmentGrid.tsx:432` feeds `isFreshGrade`'s round boundary —
>   **the exact §7.227 mechanism fixed two commits ago.**
> - Plus `coachDisableImpact.ts:80`, `calendarLessons.ts:302,344`, the coach attendance/roster/
>   schedule screens, the parent Attendance screen, and admin `lessons/[classId]/[date]`.
>
> A raw string returned there flows into `parseDate` → `NaN` → `expectedLessonDates` returns
> `[]`, and the screen reports **"nothing expected"**. Coverage looks complete. Grades
> misclassify fresh as stale. Nothing throws, so nothing is noticed.
>
> **NAMED PROHIBITION: do not add a NaN guard, a try/catch, or any degrade path to
> `toSgDate`, `todayInSg`, or `parseDate`.** They throw on purpose. A date primitive that
> guesses is worse than one that stops.

Add a **new, display-only** export to `lib/lessonDates.ts` — in **both twins**:

```ts
/**
 * A timestamptz (or a "YYYY-MM-DD") shown as its Singapore calendar date.
 *
 * DISPLAY ONLY — never feed the result back into date logic. It degrades to the
 * raw input on an unparseable value rather than throwing, because a bad string in
 * a table cell is visible and harmless, where the same string inside a comparison
 * is a wrong answer nobody sees. `toSgDate()` deliberately still throws: 34 call
 * sites compare its output lexically. Do not "fix" that one to match this one.
 */
export function formatSgStamp(
  iso: string,
  opts?: Intl.DateTimeFormatOptions
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatSgDate(todayInSg(d), opts);
}
```

This closes `BACKLOG.md`'s *"`toSgDate()` THROWS on a malformed timestamp"* item **for the
display half only**, which is the half that had a reachable failure. Record in that item that
the logic half was considered and **refused**, with the reason above.

> **⚠ RISK 3 MITIGATION — `lessonDates.ts` is the one shared file with NO byte-identity test,
> and this step edits both copies by hand.** Verified: `studentStatus`, `skillProgress`,
> `attendanceCompleteness` and `attendanceSave` all have `.drift.test.ts` identity checks.
> **`lessonDates` has only the header comment "Keep in sync"** — which is exactly the
> protection `studentStatus.drift.test.ts:1-4` calls out as the kind that "does not survive the
> person who has not read it." It is the file the entire date system stands on.
>
> **STEP:** extend the new drift test (Step 1) to assert the two copies are byte-identical
> **apart from line 3**, the TWIN FILE pointer, which names the *other* file and is the only
> legitimate difference today (verified: `diff` reports that one line and nothing else).
> **Prove it RED** by adding a character to one copy before adding the real change.

---

## 3. Step 1 — The drift guard, proven RED first

Two files, same scanner: `SwimSyncAdmin/lib/sgDisplay.drift.test.ts` (vitest) and
`SwimSyncApp/lib/sgDisplay.drift.test.ts` (jest). Both `readFileSync` over real source, repo
root at `join(__dirname, "..", "..")` — the `studentStatus.drift.test.ts` pattern.

**Scanner rules:**
1. Strip `//` and `/* */` comments **before** matching.
2. Find `toLocaleDateString(` / `toLocaleString(` / `toLocaleTimeString(`.
3. **Balance parens forward** to the closing paren — not line-by-line.
4. Fail any span lacking `timeZone`, unless allowlisted by **file + content snippet**.
5. Fail any span containing `timeZone: "UTC"` outside `lessonDates.ts`.
6. Assert the `lessonDates.ts` twins are byte-identical except line 3.

Rule 3 is load-bearing: `history/page.tsx:56` opens the call on one line and puts `timeZone` on
the next. A line-based grep flags it, someone allowlists it, and the one file that most deserves
the guard escapes it.

> **⚠ RISK 2 MITIGATION — presence of `timeZone` is not correctness, and `"UTC"` would pass.**
> A site rendering a `timestamptz` with `timeZone: "UTC"` satisfies a naive scanner while
> showing the wrong date 8 of every 24 hours — the §7.227 bug shape, now with a **green guard
> over it**. Hence **scanner rule 5**. `formatSgDate` legitimately pins UTC (it formats a
> `"YYYY-MM-DD"`, where UTC is the *only* correct choice), so `lessonDates.ts` is the sole
> exemption and is named in the rule, not allowlisted per-line.
>
> Note the fixed sites do not merely *satisfy* the scanner — after Step 2/3 they contain no
> `toLocale*` call at all. **The pattern is removed, not appeased.** That is structural.
>
> **ASSERTION (committed, permanent) — add to BOTH `lessonDates.test.ts`,** using the
> `process.env.TZ` five-zone pattern those files already run at lines 112–124 and 141–152:
> ```ts
> for (const tz of ["Asia/Singapore","UTC","America/New_York","Pacific/Midway","Pacific/Auckland"]) {
>   process.env.TZ = tz;
>   expect(formatSgStamp("2026-08-30T23:30:00+08:00",
>     { day:"2-digit", month:"2-digit", year:"numeric" })).toBe("30/08/2026");
>   expect(formatSgStamp("2026-08-30")).toBe("Sun, 30 Aug");
>   expect(formatSgStamp("not-a-date")).toBe("not-a-date");   // degrades, never throws
> }
> ```
> §7.227 records the house rule this satisfies: *"the deterministic pin belongs in vitest…
> across five zones."* A single manual `TZ=… npm test` is weaker and is **not** a substitute.

> **⚠ RISK 4 MITIGATION — the "expect 15 failures" claim is FALSE, and a wrong count invites
> a wrong fix.** The scanner also fires on `SwimSyncAdmin/lib/accounting.ts:22` —
> `Math.abs(v).toLocaleString("en-SG", {…})` formats a **Number** (currency), where `timeZone`
> is meaningless. The danger is not the red; it is someone silencing it by adding a `timeZone`
> option to a currency formatter. (`accounting.ts:36` is already fine — it pins `"UTC"` on a
> date and sits inside rule 5's scope, so classify it explicitly.)
>
> **STEP:** after the scanner runs red, **enumerate every failure and classify it before Step 2
> begins.** **PASS CONDITION: every red is either one of the 15 fix targets, or an allowlist
> entry pinned to file *and content snippet* with a written justification.** Do not assert a
> count — comment-stripping changes it, and per `CLAUDE.md` the runner is the fact.
>
> **NAMED PROHIBITION: never add a `timeZone` option to a `Number.prototype.toLocaleString`
> call.** It does nothing, and it converts a false positive into a permanent lie.

---

## 4. Step 2 — The 10 admin `timestamptz` sites

Each becomes `formatSgStamp(x, { day:"2-digit", month:"2-digit", year:"numeric" })`.

| File | Lines | Columns |
|---|---|---|
| `app/(admin)/invoices/page.tsx` | 1666, 1693, 1726 | `paid_claimed_at`, `reminded_at` ×2 |
| `app/(admin)/referrals/page.tsx` | 319, 325, 352, **353** | `created_at`, `converted_at`, `earned_at`, **`expires_at`** |
| `app/(admin)/packages/page.tsx` | 1030, 1069 | `requested_at` ×2 |
| `components/WhatsAppQueue.tsx` | 102 | `openedStamp` |

Imports: `invoices` already imports `formatSgDate`; `packages` imports `todayInSg`; `referrals`
and `WhatsAppQueue` need a fresh import. Line 1693 is inside a `title={…}` template string —
the substitution is the same, but it is the one site with no visible cell to eyeball.

> **⚠ RISK 6 MITIGATION — "byte-identical output" is an assumption about ICU's default
> pattern, not a fact of the code.** Verified by execution that `toLocaleDateString("en-SG")`
> renders `"05/08/2026"` — 2-digit even for a single-digit day — so
> `{day:"2-digit",month:"2-digit",year:"numeric"}` matches today exactly. But that is an ICU
> default, and defaults move between runtimes.
>
> **ASSERTION:** fold a single-digit-day case into the Step 1 test —
> `formatSgStamp("2026-08-05T10:00:00+08:00", {day:"2-digit",month:"2-digit",year:"numeric"})`
> `=== "05/08/2026"`. If ICU ever changes the default pattern, this catches it instead of
> assuming it.

Null guards at `referrals/page.tsx:325` (`"—"`) and `:353` (`"never"`) sit **outside** the
changed expression and stay exactly as they are.

`expires_at` (line 353) is the money site. The DB enforces the true instant
(`referral_rewards.expires_at > now()`, `20260815000700_referrals.sql:494`), so today the *rule*
is right while the *screen* can be a day out. After this step they agree.

---

## 5. Step 3 — The 5 SwimSyncApp `formatDate` helpers

One line each, covering ~8 call sites. **Each keeps its own existing `opts`** — no visible
format change anywhere in the app.

| File | Helper | Fed by |
|---|---|---|
| `app/(parent)/attendance/index.tsx` | 87 | `session_date` |
| `app/(parent)/billing/index.tsx` | 96 | `pkg.expires_on`, `cn.issued_at` |
| `app/(parent)/billing/invoice/[id].tsx` | 69 | `generated_at`, `paid_at`, `session_date` |
| `app/(parent)/home/child/[id].tsx` | 78 | `date_of_birth` |
| `app/(coach)/classes/[id]/attendance.tsx` | 102 | `session_date` |

These helpers are each fed **both** a `timestamptz` and a DATE string — which is why the fix had
to be one shape that handles both (§1). Existing null guards (`if (!dateStr) return "—"`) stay.

> **⚠ RISK 5 MITIGATION — these are parent/coach screens the nightly drivers DO exercise, and
> the nightly runner is UTC.** §7.227 records that **43 of the 50 drivers deliberately do not
> pin `timezoneId`**. Any driver asserting a date string derived from a `timestamptz` can flip
> between 16:00–24:00 UTC — a red that appears **only in nightly CI**, which is precisely the
> "the local run hides it" trap of the last three commits.
>
> **STEP, before shipping:**
> ```
> grep -rnE '(getByText|toContainText|expect).*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|/20[0-9]{2})' \
>   .claude/skills/run-ui-playwright/drivers/
> ```
> Run any driver that hits, once, locally with `TZ=UTC`.
>
> **NAMED PROHIBITION: if a driver reds on a date after this change, do NOT fix it by pinning
> `timezoneId`.** §7.227 makes that a standing prohibition — the unpinned driver on a UTC
> runner is what caught the round-boundary bug, and every SGT-local run passed through it.
> Fix the product, or assert on something that is not a rendered date.
>
> This mitigation is **vigilance-class, and that is a compromise**: driver assertions are free
> text, so no structural check can prove a driver does not depend on a rendered date. The grep
> narrows it; it does not close it.

---

## 6. Step 4 — Allowlist, verify, ship

**Allowlist — billing-month-from-parts.** These build `new Date(y, m-1, 1)` at **local**
midnight and render month+year only; a local-midnight Date formatted in that same local zone
always yields that month. Verified from `America/New_York`: still `August 2026`. Pin each by
file **and content snippet**, never file-level.

- Admin: `invoices/page.tsx:113`, `dashboard/page.tsx:46`
- App: `billing/paynow.tsx:114`, `billing/index.tsx:93`, `billing/invoice/[id].tsx:67`,
  `lib/payoutBreakdown.ts:139`, `app/invoice/[token].tsx:39`
- Admin: `lib/accounting.ts:22` — a **Number**, not a date (RISK 4)

**Must PASS unmodified, with NO allowlist entry** — they already spell
`timeZone: "Asia/Singapore"`: `history/page.tsx:56`, `unassigned/page.tsx:98`,
`unassigned/page.tsx:175`. If any of these needs an allowlist entry, the scanner's paren
balancing is broken — fix the scanner, not the allowlist.

**Verification:** `npm test` + `npm run typecheck` in both apps, `next build` in the admin,
`check-fixture-roundtrip.sh`. The five-zone assertions from Step 1 are the real proof; a manual
`TZ=America/New_York npm test` is a sanity pass on top, not the evidence.

**Deploy:** apps-only. No migration, no edge function, so no §7.60 ordering hazard — a plain
push to `main` is the whole deploy.

---

## 7. Coverage

| Guard | Where | Proves |
|---|---|---|
| Five-zone composition + degrade + single-digit day | both `lessonDates.test.ts` | `formatSgStamp` is zone-independent, never throws, byte-identical to today |
| `toLocale*` without `timeZone` | both `sgDisplay.drift.test.ts` | an 11th offender cannot be added |
| `timeZone: "UTC"` outside `lessonDates.ts` | both `sgDisplay.drift.test.ts` | the guard cannot be satisfied wrongly (RISK 2) |
| `lessonDates.ts` twin byte-identity | `sgDisplay.drift.test.ts` | the shared date primitive cannot drift (RISK 3) |

Every one of these must be **proven RED before the fix** (§7.25). A test that has never failed
is not coverage.

---

## 8. Pre-commit gate — WALKED 2026-08-30

A box that cannot be ticked is a **blocker, not a caveat**. All boxes are ticked.

- [x] **RISK 1** — `toSgDate` / `todayInSg` / `parseDate` are **unchanged**. `git diff` on both
      `lessonDates.ts` is **42 insertions, 0 deletions** — `formatSgStamp` only. The prohibition
      is in the new function's docblock, where the next caller will read it.
- [x] **RISK 2** — five-zone assertions committed in both `lessonDates.test.ts`. **RED-proven**:
      given the buggy body (`new Date(iso).toLocaleDateString("en-SG", opts)`), **all 5 fail**.
      Scanner rule 5 **RED-proven** by re-writing `referrals/page.tsx:319` as
      `toLocaleDateString("en-SG", { timeZone: "UTC" })` — the guard rejected it by line number.
- [x] **RISK 3** — twin byte-identity assertion committed, **RED-proven** by appending one line
      to `SwimSyncApp/lib/lessonDates.ts`.
- [x] **RISK 4** — **26 spans enumerated and classified before Step 2 began**: 15 fix targets,
      9 allowlist entries (7 month-from-parts, 1 Number, 1 UTC-built-formatted-UTC), 2
      `lessonDates.ts` spans exempt by file. Every allowlist entry is pinned to file **and**
      snippet with a written reason; none is file-level. No `timeZone` was added to any Number
      formatter.
      **Two scanner bugs were found and fixed by this enumeration, not by review:** dropping
      line-comment characters shifted every span after the first `//` and reported
      `history/page.tsx` — a *correct* site — as an offender; and blanking template-literal
      bodies hid `invoices/page.tsx:1693` entirely. A third, subtler one: a flat 400-character
      allowlist window reached into the neighbouring function and silently allowlisted two real
      offenders (`billing/index.tsx:97`, `invoice/[id].tsx:71`). **An allowlist that matches by
      proximity is not an allowlist** — it is now bounded to the enclosing block.
- [x] **RISK 5** — driver grep run across all 50 drivers. **7 hits, all false positives**
      ("Ma**r**k", "**Jul**ia", "Ma**y**a"); **no driver asserts a rendered date**, so no
      `TZ=UTC` driver run was needed and no `timezoneId` was pinned.
- [x] **RISK 6** — single-digit-day assertion committed (`"05/08/2026"`, five zones). Admin
      output confirmed still `30/08/2026` in SGT — the ten cells are byte-identical to before.
- [x] All new tests proven RED without the fix (§7.25) · admin vitest **630** · app jest **429**
      · both typechecks clean · `next build` clean · fixture roundtrip **26/26** · both suites
      re-run green under `TZ=America/New_York` and `TZ=Pacific/Midway`.
- [x] The 3 "must pass" sites (`history/page.tsx:56`, `unassigned/page.tsx:98,175`) pass with
      **no** allowlist entry — they were false reds until the scanner's paren balancing and
      comment handling were correct, which is exactly the signal that check exists to give.

## 9. Durable findings to graduate at `/update-docs`

- **A new §7 gotcha: `toSgDate` throws ON PURPOSE — display and logic need different helpers.**
  The reasoning in RISK 1 belongs in `docs/GOTCHAS.md`, not only here: the next person to meet a
  `RangeError` from a date helper will reach for the same guard this plan nearly shipped, and a
  plan file is discarded when the work lands. Cite the 34 call sites and
  `attendanceCompleteness.ts` by name.
- **A second §7 gotcha: a guard that checks for `timeZone` does not check for the RIGHT one.**
  `timeZone: "UTC"` on a `timestamptz` passes a naive scanner and is wrong 8 hours a day.
- `BACKLOG.md`: close the ten-`timestamptz` item; close the `toSgDate`-throws item as
  **display-half done, logic-half refused**, with the reason. Add the App's date-string family
  as covered by this plan, not as a new entry.
- `PRD.md` needs nothing — no user-visible behaviour changes in Singapore.
