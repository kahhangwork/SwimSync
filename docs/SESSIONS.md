# SwimSync — Session ledger (§8, older sessions)

_One row per session, oldest work at the bottom. Split out of `HANDOVER.md` on 2026-08-10,
when the ledger had reached 21.5 KB — 24% of a file that is read at the start of every
session. `HANDOVER.md` §8 keeps the two most recent sessions in full and points here for
everything older, so this is still one hop._

**Never delete a row.** They are cited by number from source files and applied migrations
(`core.ts` and `20260727000100_…sql` both say `§8a`), and an applied migration can never be
corrected — a missing row is a dangling reference.

**A row is a POINTER, not a story: 200 characters, hard cap.** Number, date, what shipped in
one clause, and where the reasoning now lives. The rows written in July cost ~130 characters
each, which is the ~25 tokens the rule always claimed. The rows written across August
average 1,050 and peak at 1,446 — ten times the budget, every one of them still technically
"one row", which is how `HANDOVER.md` went from 38 KB to 91 KB in nine days. A row that
needs more than 200 characters is a row whose reasoning was never graduated: give it a home
in `docs/`, `PRD.md` or `BACKLOG.md` first, then point at that home.

**Verify a pointer resolves before you write it** — `grep` the target for the number. The
§8.38 row below cited `§7.108` for a `SECURITY DEFINER` audit-trigger lesson; §7.108 is
about a Playwright cold-compile timeout, and **no gotcha covered the lesson at all** — the
row had been carrying its full narrative precisely *because* the delegation it claimed was
never checked. Fixed 2026-08-10 by writing the missing gotcha (**§7.120**) and repointing
the row. An unverified pointer does not delegate anything; it just looks like it did.

_Every row below is ≤200 characters as of 2026-09-27, when the last 30 oversized rows were
compressed after tracing each fact to a home. Measure CHARACTERS, not bytes:
`perl -CSD -nle 'print if /^\| \*\*8/ && length>200' docs/SESSIONS.md` must print nothing (§7.283)._

| # | Date | What shipped | Where its reasoning lives now |
|---|---|---|---|
| **8.132** | 2026-09-27 | Wave 2: package revenue on Accounting, in-app refunds | PRD §7.16/§7.23 · ARCHITECTURE §6ac · §7.297–§7.301 · DEPLOYMENT #59 |
| **8.131** | 2026-09-27 | Wave 1: roles & permissions, crash-safe email claim; sign-up role escalation closed | PRD §4.3/§7.7 · ARCHITECTURE §6aa/§6ab · §7.289–7.294 · DEPLOYMENT #56–58 |
| **8.130** | 2026-09-27 | Build order re-ranked; Wave 1 planned + reviewed; plans indexed | BACKLOG *Current build order* · docs/plans/README.md · §7.287–§7.288 |
| **8.129** | 2026-09-27 | Admin sees a childless family's name; a refused run-day save is loud; component tests | PRD §5.1, §7.7 · TESTING §5 · §7.283–§7.286 · DEPLOYMENT #55 |
| **8.128** | 2026-09-26 | Foundations driver backlog: 11 nightly drivers + `simulate-date.sh`, all driver-only | `docs/plans/DRIVER_BACKLOG_PLAN.md` · TESTING §5 · §7.276–§7.282 |
| **8.127** | 2026-09-26 | Segment-bounded `isPublicPage`; NativeWind `darkMode: "class"` stops a per-load throw | ARCHITECTURE §10 · §7.275 · DEPLOYMENT §11 #54 |
| **8.126** | 2026-09-26 | Deployed `public-package` CORS probed read-only: `Allow-Headers: content-type`; §7.264 holds | §7.264 |
| **8.125** | 2026-09-26 | A late session restore no longer wipes the reset/invite form; `app-money` C2 driven | §7.274 · TESTING §5 · DEPLOYMENT §11 #53 |
| **8.124** | 2026-09-25 | Dead `auto_invoice_enabled` row dropped; no driver hardcodes an app port | §7.93 · TESTING §5 · DEPLOYMENT §11 #52 |
| **8.123** | 2026-09-25 | Save-on-leave running-low fields; signed-out `/register`; dead run-day row dropped | PRD §7.16/§5.1 · ARCHITECTURE §10 · DEPLOYMENT §11 #51 |
| **8.122** | 2026-09-25 | Gate nightly red on one `app-auth` login; a local 25/25 accepted as the gate | §7.263 · §7.274 (the step-4 cause, fixed §8.125) |
| **8.121** | 2026-09-25 | Gotchas filed twice became checks; GOTCHAS.md 347→186 KB | TESTING §5 (`recurring_gotchas.test.sql`) · GOTCHAS topic index · `/update-docs` Step 4 |
| **8.120** | 2026-09-24 | Ten small units behind one nightly: refresh keeps your screen, SGT greeting, et al. | PRD §7.1/§7.6/§7.15/§7.16 · §7.271–7.273 |
| **8.119** | 2026-09-24 | Engine run day per tenant (v29), cancelled-lesson notice, 4 verify-app drivers | docs/plans/ENGINE_TENANT_RUN_DAY_PLAN.md · §7.265–7.270 |
| **8.118** | 2026-09-23 | App L-F/G/H + fence: refactor programme done in both apps | docs/refactor/BATCH_FGH_PLAN.md · §7.261–7.264 |
| **8.117** | 2026-09-22 | Billing months card + generation run log; August 2026 closed on prod | docs/plans/BILLING_MONTHS_PLAN.md · §7.255–7.260 |
| **8.116** | 2026-09-22 | Coach Schedule full track: 1,255 → 101 lines, the last giant | docs/refactor/COACH_SCHEDULE_REFACTOR_PLAN.md · §7.253–7.254 |
| **8.115** | 2026-09-22 | Coach attendance full track: 1,183 → 166 lines, the marking screen | docs/refactor/COACH_ATTENDANCE_REFACTOR_PLAN.md · §7.253–7.254 |
| **8.114** | 2026-09-21 | Coach roster full track: 905 → 64 lines, the first app unit + the app fence | docs/refactor/COACH_ROSTER_REFACTOR_PLAN.md · §7.252 |
| **8.113** | 2026-09-21 | Admin L-E + the fence commit: every admin route fenced, both ledgers empty | docs/refactor/BATCH_E_PLAN.md · §7.251 |
| **8.112** | 2026-09-18 | Lesson detail full track: 912 → 93 lines, the last admin giant | docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md · §7.250 · BACKLOG verify-lesson-detail-guests |
| **8.111** | 2026-09-18 | Admin L-D grading batch: 5 route units, 2,667 → 316 lines, 0 hooks | docs/refactor/BATCH_D_PLAN.md · §7.247–7.249 · ARCHITECTURE §6 · BACKLOG verify-grading-admin |
| **8.110** | 2026-09-18 | `platform/page.tsx` full-track: 1,395 → 237 lines, 0 useState | docs/refactor/PLATFORM_REFACTOR_PLAN.md · §7.243–7.246 · playbook §5 |
| **8.109** | 2026-09-17 | Admin L-C money batch: 4 pages to tiers, 2,309 → 394 lines, 0 useState | docs/refactor/BATCH_C_PLAN.md · playbook §2/§4 · BACKLOG verify-money-admin |
| **8.108** | 2026-09-17 | `classes/page.tsx` full-track: 1,714 → 164 lines, 0 useState, zero behaviour change | docs/refactor/CLASSES_REFACTOR_PLAN.md · §7.242 · playbook §2 |
| **8.107** | 2026-09-17 | August billing diagnosed, no code: 9 invoices out, month held open by one unclaimed child | INVOICE_RUNBOOK.md · BACKLOG Billing and payments |
| **8.106** | 2026-09-16 | `invoices/page.tsx` full-track: 1,748 → 200 lines, 0 useState, zero behaviour change | docs/refactor/INVOICES_REFACTOR_PLAN.md · §7.241 · playbook §5 |
| **8.105** | 2026-09-16 | Admin L-B lite batch: 5 calendar pages to tiers, 2,387 → 440 lines, 0 useState, zero behaviour change | docs/refactor/BATCH_B_PLAN.md §12 · §7.240 · playbook §1, §5 |
| **8.104** | 2026-09-16 | `packages/page.tsx` full-track (2nd giant): 2,014 → 244 lines, zero behaviour change | docs/refactor/PACKAGES_REFACTOR_PLAN.md · §7.239 · ARCHITECTURE §6 |
| **8.103** | 2026-09-14 | Admin L-A lite batch: 5 "people" pages to tiers, zero behaviour change | docs/refactor/BATCH_A_PLAN.md · playbook §7.1 (lite track) |
| **8.102** | 2026-09-13 | Smoke drivers for every route, both apps (admin 64 + app 73 checks); feature-tier rollout set to every page, 3 tracks | §7.237 · §7.238 · docs/TESTING.md §5 |
| **8.101** | 2026-09-12 | The nightly's two reds were driver date-rot, not product bugs; fixed driver-only (7667643) | §7.234 (date-rot family) · §7.122 · §7.98 |
| **8.100** | 2026-09-12 | Admin Students page decomposed into ui/domain/dao tiers, 12 stages, zero behaviour change; now a playbook | §7.233–236 · refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md |
| **8.99** | 2026-08-30 | A branded signup-confirmation email that is never sent (dormant by design), + a CI guard on the stranding toggle | §7.231, §7.232 · `authEmailConfig.drift.test.ts` |
| **8.98** | 2026-08-30 | Every displayed date is Singapore's: 15 sites → a display-only `formatSgStamp()`, held by a source-scanning guard | §7.229, §7.230 · plans/SGT_DISPLAY_PLAN.md |
| **8.97** | 2026-08-30 | The nightly's OTHER red was a DRIVER bug: a flat `waitForTimeout` read the page before the API returned, hiding seven unrun checks | §7.228 · BACKLOG |
| **8.96** | 2026-08-30 | The nightly's assessment red was a PRODUCT bug: the round used the VIEWER's midnight, not Singapore's | §7.227 · PRD §7.15 · BACKLOG |
| **8.95** | 2026-08-30 | Reset-first driver sweep: 50/50 green after five driver/fixture fixes; two 1 Sep time bombs defused | §7.223–§7.226 · BACKLOG |
| **8.94** | 2026-08-29 | Assessment tab exercised on prod, grading no longer dormant; one copy/driver-regex fix `ccb60be` | §7.223 · plans/GRADING_ADMIN_ONLY_PLAN.md §11 |
| **8.93** | 2026-08-29 | Grading becomes ADMIN-ONLY + an Assessment tab, `20260829000100` | `GRADING_ADMIN_ONLY_PLAN.md` · PRD §7.15 · §7.219–§7.222 · §11.46 |
| **8.92** | 2026-08-28 | Wave C S-pool 4: per-child swim-skill grading, coach-graded, `20260828000100` | `docs/plans/WAVE_C_SPOOL_PLAN.md` · PRD §7.15 |
| **8.91** | 2026-08-28 | Wave C S-pool 1–3: scoped DB search, family-search pushdown, move-student RPC (fixed a LIVE prod bug), `20260827000100` | §7.216–§7.218 · PRD §4.4/§14 |
| **8.90** | 2026-08-27 | 3 nightly drivers repaired, no product regression (the "Sep"/"Sept" trap + 2 more) | §7.215 · `be34398` |
| **8.89** | 2026-08-24 | Location entity CONTRACT: free-text location columns dropped on prod (one-way) | §7.211 · §7.214 · PRD §7.24 · DEPLOYMENT §11.43 |
| **8.88** | 2026-08-24 | Location entity EXPAND: class location → per-tenant `locations` | §7.211–§7.213 · PRD §7.24 · DEPLOYMENT §11.42 · plans/LOCATION_ENTITY_PLAN.md |
| **8.87** | 2026-08-24 | Owner-only accounting page: accrual P&L per closed month | PRD §7.23 · DEPLOYMENT §11.41 · plans/ACCOUNTING_PAGE_PLAN.md |
| **8.86** | 2026-08-23 | Partial-payment CLOSED: re-correcting a FOLDED-and-debited note stays refused (`CN002`) → *Deliberately not doing*; docs-only | §7.206–§7.207 · BACKLOG |
| **8.85** | 2026-08-23 | Tenant-admin invite link lasts 24h (email says so): auth `mailer_otp_exp` 3600→86400 on prod via Management API; app-only `34db287` | §7.210 · PRD §4.4 |
| **8.84** | 2026-08-23 | Partial-payment follow-ups: pending-debit auto-unwind, charges panel + write-off, offboard guard (`20260822000200`) | §7.207–§7.209 · PRD §5.6 · DEPLOYMENT §11.40 |
| **8.83** | 2026-08-22 | Partial payment: a void on a paid invoice folds onto the next one via `debit_balance` | §7.206 · PRD §5.6 · DEPLOYMENT §11.39 |
| **8.82** | 2026-08-22 | Advance-cancel EXTENDS a prepaid package (`20260821000800`, DB-only); + unassigned sidebar badge, `/deploy` skill | §7.205 · PRD §7.6 · DEPLOYMENT §11.38 |
| **8.81** | 2026-08-21 | Advance-cancel a lesson shipped + deployed; mark-refusal is the DB trigger | §7.203/§7.204 · PRD §7.6 · DEPLOYMENT §11.37 |
| **8.80** | 2026-08-21 | Parent Upcoming also lists booked make-ups + admin extra lessons (explicit rows win, not holiday-subtracted); app-only `8cf219c` | PRD §7 · `computeUpcomingLessons` |
| **8.79** | 2026-08-21 | `add_unclaimed_student` ONGOING arm made ADMIN-ONLY (coach arm closed — a decision); `20260821000600` | §7.202 · PRD §7.17 · DEPLOYMENT §11.36 |
| **8.78** | 2026-08-21 | Enrolment-vs-retire race CLOSED+DEPLOYED: `enforce_enrolment_schedule` reads `is_active` under `FOR UPDATE` on `NEW.class_id` | §7.201 · DEPLOYMENT §11.35 |
| **8.77** | 2026-08-21 | Booking-vs-retire race CLOSED+DEPLOYED: `book_makeup`/`book_trial` take the class `FOR UPDATE` lock unconditionally, re-read `is_active` | §7.200 · DEPLOYMENT §11.34 |
| **8.76** | 2026-08-21 | Parent self-enrolment AND coach-assisted assignment both REFUSED — assignment stays superadmin; docs-only | `BACKLOG.md` → *Deliberately not doing* · PRD Phase 3 |
| **8.75** | 2026-08-21 | Two `classes` hardening guards SHIPPED+DEPLOYED: capacity last-seat `FOR UPDATE` lock; raw-`UPDATE` retirement guard trigger | §7.198/§7.199 · DEPLOYMENT §11.33 |
| **8.74** | 2026-08-21 | No-op substitute REFUSED (`assign_session_coach`, `20260821000100`); both admin pickers hide the paid coach | §7.197 · PRD §7.6 · DEPLOYMENT §11.32 |
| **8.73** | 2026-08-21 | Capacity HARD limit · holiday retirement SGT-inclusive · Lessons sidebar badge, all LIVE; 3 migrations | §7.194-196 · PRD §7.3/§7.6/§7.22 · DEPLOYMENT §11.31 |
| **8.72** | 2026-08-20 | Nightly sweep triaged: `invoice-controls` 14/18 was a pixel pin under the 08-17 rem auto-scale, not a product move — asserts in rem now | §7.193 · TESTING §5 |
| **8.71** | 2026-08-19 | Admin calendar + lesson page LIVE: capacity/colour, `/calendar`, `/lessons` (admin marks attendance) | §7.191-192 · PRD §7.3/§7.6/§7.22 · DEPLOYMENT §11.30 |
| **8.70** | 2026-08-19 | Public-holiday voids LIVE: `holiday` status event-extends packages; calendar-scan recompute dropped; engine v25 | §7.188-190 · PRD §7.16 · DEPLOYMENT §11.29 |
| **8.69** | 2026-08-18 | Wave D LIVE: engine ordering-guard (no force), credit lock `apply_credit_to_invoice`, admin void of a credit note; engine v24 | §7.187 · PRD §5.6/§7.7 · WAVE_D_PLAN.md |
| **8.68** | 2026-08-18 | Symmetric credit notes — a re-toggled correction stops doubling a parent's credit; CN001 refuses un-correcting spent credit | §7.184-186 · PRD §5.6 |
| **8.67** | 2026-08-17 | Admin UI polish: responsive auto-scaling + collapsible grouped sidebar (4+4); Lesson Coaches→Substitutes (308), Coach Wages→Wages | §7.181-183 · §11.27 |
| **8.66** | 2026-08-17 | Wave C LIVE (app-only): CSV export, convert-a-trial, parent upcoming-lessons, make-up-from-Attendance, Change History | §7.179-180 · PRD §7.5/7.17/7.20 · WAVE_C_PLAN.md |
| **8.65** | 2026-08-17 | CI red 20 commits on a typed "future" fixture date; a page-count pin hid a latent PGRST201 that emptied the package catalogue (prod 0 rows, no loss) | §7.176–178 |
| **8.64** | 2026-08-17 | Credit-note email notifications, LIVE DORMANT (0 notes) — one email per note w/ two amounts, admin Resend for a miss | PRD §7.8 · §11.25 · §7.172–175 |
| **8.63** | 2026-08-16 | Invoice-email delivery tracking + RETRY, LIVE DORMANT — a re-run re-sends only the misses, even on a sealed month, no duplicate | PRD §7.7 · §11.24 · §7.170–171 |
| **8.62** | 2026-08-16 | Backlog RE-RANKED after the referral queue drained (docs only) — revenue ACCRUAL, reminders MANUAL, multi-language REFUSED | `BACKLOG.md` → Build order |
| **8.61** | 2026-08-15 | Parent REFERRAL CODES, LIVE DORMANT — `REF-` code, double-sided FIFO discount, same-household guard, admin Referrals page | PRD §7.16 · §11.23 · §7.164–169 |
| **8.60** | 2026-08-15 | Package RENEWAL AUTOMATION — admin offers + tokenised `/package` pay page + WhatsApp queue, LIVE DORMANT | PRD §7.16 · `docs/DEPLOYMENT.md` §11.22 · §7.158–163 |
| **8.59** | 2026-08-15 | Weeks/holiday-extension packages, live dormant | PRD §7.16 · `PACKAGE_WEEKS_HOLIDAYS_PLAN.md` |
| **8.58** | 2026-08-15 | Remove the stale per-coach PayNow QR column from admin Coaches (`892e2cc`, app-only) — a mislabeled mirror of the BUSINESS's QR, unchanged | PRD §7.10 |
| **8.57** | 2026-08-14 | Turn OFF the `service_role` default-privilege grant (`20260814000300`), LIVE; whitelist rejected | `docs/DEPLOYMENT.md` §11.20 · BACKLOG *Deliberately not doing* |
| **8.56** | 2026-08-14 | Warn on a possible duplicate at Add-student: `find_roster_duplicates` (`20260814000200`) + app, LIVE | PRD §7.18 · `docs/plans/ADD_STUDENT_DUP_WARNING_PLAN.md` |
| **8.55** | 2026-08-14 | Duplicate banner (`70b5e32`, app-only) compares only same-parent-situation rows — no false flag on a claimed child | PRD §7.18 · `docs/DEPLOYMENT.md` §11.18 |
| **8.54** | 2026-08-14 | Set a claimed child's real name: `rename_student` (`20260814000100`) + Students Rename + claim name picker | PRD §7.17 · `docs/DEPLOYMENT.md` §11.17 · §7.154–155 |
| **8.53** | 2026-08-14 | Attendance Coach column speaks the money axis (`f2fd7bc`), not `classes.coach_id`; app-only | PRD §7.13 · `docs/DEPLOYMENT.md` §11.16 · §7.152 · `SMALL_ITEMS_PLAN.md` |
| **8.52** | 2026-08-13 | Admin audit trail survives deletion (`20260813000400`); pre-flight sees extra + retired-class lessons | PRD §4.3, §7.7 · `docs/DEPLOYMENT.md` §11.15 · §7.152–153 |
| **8.51** | 2026-08-13 | **Wave 5 chunk 3** (`20260813000300` + engine v21): tenant suspension; the wave is complete | PRD §4.4 · `docs/DEPLOYMENT.md` §11.14 · §7.148–151 |
| **8.50** | 2026-08-13 | **Wave 5 chunk 2** (`20260813000200`): disable a coach, atomic handover | PRD §4.3 · `docs/DEPLOYMENT.md` §11.13 · §7.147 |
| **8.49** | 2026-08-13 | **Wave 5 chunk 1** (`20260813000100`): owner transfer, platform-admin only | PRD §4.4 · `docs/DEPLOYMENT.md` §11.12 · `docs/plans/WAVE_5_PLAN.md` |
| **8.48** | 2026-08-12 | **Wave 4** (`20260812000400`): sealed-month unbilled lessons reported + settled | PRD §7.17 · `docs/DEPLOYMENT.md` §11.11 · `docs/TESTING.md` §5 |
| **8.47** | 2026-08-12 | **The shim drop** (`20260812000300`): 4-arg `assign_session_coach` + enum gone, on schedule | `docs/DEPLOYMENT.md` §11.10 · §8.46 |
| **8.46** | 2026-08-12 | **Class-level shadow coaches** (`20260812000200`), LIVE; subs stay per-lesson | **§7.143–§7.146** · `docs/ARCHITECTURE.md` §6z · `CLASS_SHADOW_COACHES_PLAN.md` |
| **8.45** | 2026-08-12 | **The owed-main guard** (`20260812000100`) + `verify-coach-roster.mjs`; guard deleted a day later by §8.46 | **§7.137–§7.141** · `WAVE_3_FOLLOWUP_PLAN.md` |
| **8.44** | 2026-08-11 | **Wave 3 — a lesson has its own coaches** (`20260811000200`); apps deployed ahead of their migration | **§7.129–§7.136** · `WAVE_3_PLAN.md` · §11.9 |
| **8.43** | 2026-08-11 | **Wave 2 — a child in >1 class** (`20260811000100`); a dropped signature broke the live admin for one build | **§7.123–§7.127** · `docs/plans/WAVE_2_PLAN.md` |
| **8.42** | 2026-08-10 | `verify-schedule-week` 17/19 → **21/21** — driver rot, not §8.40; exonerated by re-running at the suspect's parent | **§7.121, §7.122** · `docs/TESTING.md` §5 |
| **8.41** | 2026-08-10 | **`HANDOVER.md` 91 KB → 39 KB, nothing lost** — this ledger split out here, datelines 5→1, §3 halved | **§7.119** · `BACKLOG.md` *(the refused CI byte-gate)* |
| **8.40** | 2026-08-10 | **An unmarked GUEST blocks the month**; retired classes refuse bookings — `20260810000100`, engine v20 | **§7.114–§7.118** · PRD §7.5 · `docs/ARCHITECTURE.md` §6 |
| **8.39** | 2026-08-09 | **A class can be RETIRED without losing money** — `is_active` means scheduling, never billing | **§7.109–§7.112** · PRD §7.3 · `docs/ARCHITECTURE.md` §6 |
| **8.38** | 2026-08-09 | Wave 1 Chunk 3: every EDIT to a child is recorded, by a `SECURITY DEFINER` trigger | §7.120 · `docs/ARCHITECTURE.md` §6 · `docs/plans/WAVE_1_PLAN.md` RISK 2 · `BACKLOG.md` |
| **8.37** | 2026-08-09 | A package purchase is numbered and QR-payable like an invoice (`PKG-YYYY-NNNN`) | §7.104, §7.105 · PRD §7.16 · `docs/plans/WAVE_1_PLAN.md` · `BACKLOG.md` |
| **8.36** | 2026-08-09 | Wave 1 got a plan (4 chunks, 17 inlined mitigations); Chunk 1 shipped, tooling only | §7.101, §7.102, §7.109, §7.120 · `docs/plans/WAVE_1_PLAN.md` · `docs/TESTING.md` §5 |
| **8.35** | 2026-08-09 | `verify-trials` passed while asserting nothing for 2 weeks: it self-skipped on a UTC weekday | **§7.100** · `docs/TESTING.md` §5 · PRD §7.5 *(guest-only lessons)* |
| **8.34** | 2026-08-08 | Coach Today became a WEEK (Schedule); parents pay from the invoice list; first backlog ranking | PRD §14.2, §7.5 · **§7.95–§7.99** · `docs/TESTING.md` §5 |
| **8.33** | 2026-08-07 | LIVE bug: `CURRENT_DATE` (UTC) refused every class edit 00:00–08:00 SGT; tests agreed with it | **§7.94** · `class_terms.test.sql` *(pg_proc scan)* · `docs/TESTING.md` §5 |
| **8.32** | 2026-08-07 | Marking floor follows the latest seal, not the calendar; LEAST only moves it earlier | PRD §7.6 · ARCHITECTURE §6 · **§7.92, §7.93** · `20260806_markable_floor_DOWN.sql` |
| **8.31** | 2026-08-06 | Co-admins: first admin is OWNER (a column, not a role); role-rewrite escalation closed | PRD §4.3 · ARCHITECTURE §6 · **§7.90, §7.91** · `20260806_co_admins_DOWN.sql` |
| **8.30** | 2026-08-05 | All UI drivers run nightly; first sweep 24/32, every red a test/harness fault | `docs/TESTING.md` §5 · run-ui-playwright `SKILL.md` · `run-all-drivers.sh` header |
| **8.29** | 2026-08-04 (2nd) | Grant audit closed 3 live forgery paths; grants a CI whitelist; ONE DB role for all, so RLS decides | **§7.86–§7.89** · §7.47 · TESTING §5 · DEPLOYMENT §11.7–11.8 |
| **8.28** | 2026-08-04 | 3 grant migrations deployed; `next_credit_note_ref` had NO ACL; default `anon` grants off | **§7.82–§7.85** · ARCHITECTURE §6 · DEPLOYMENT §11.7 |
| **8.27** | 2026-08-03 | Mobile app caught up with billing (My Pay, `INV-` refs, guests apart); 0-assertion driver cut | PRD §7.9, §14.2/§14.4 · **§7.79–§7.81** |
| **8.26** | 2026-08-02 | Fee-free payment collection (refs, PayNow QR, public invoice, WhatsApp queue); July billed | PRD §7.21 · `PAYMENT_COLLECTION_DESIGN.md` · **§7.77, §7.78, §7.284** |
| **8.25** | 2026-08-02 | Make-ups as the guest-pass model (5 migrations, engine, all UIs); host coach reads guest names | PRD §7.20 · `docs/TESTING.md` §5 · ARCHITECTURE §10 |
| **8.24** | 2026-08-02 | Parent invoice detail marks package-funded lines ("Paid by package · *name*"); app-only | PRD §7.16 · `docs/TESTING.md` §5 (`invoiceFunding`) |
| **8.23** | 2026-08-01 | Per-child, category-aware payment-method chip via `student_package_coverage()` | PRD §7.16 · `docs/TESTING.md` §5 · ARCHITECTURE §10 |
| **8.22** | 2026-08-01 | Trial-onboarding fixture's unordered `LIMIT 1` broke CI; platform "unpaid" badge never rendered | **§7.73, §7.76** · `docs/TESTING.md` §5 · PRD §4.4 |
| **8.21** | 2026-08-01 | `verify-attendance-window` "bugs" were clock rot; folded into `verify-attendance-guard` | **§7.74, §7.75** · `docs/plans/ATTENDANCE_WINDOW_DRIVER_FOLD_PLAN.md` |
| **8.20** | 2026-08-01 | CI loads every UI fixture (`check-fixture-roundtrip.sh`); first run found 3 broken | `docs/TESTING.md` §5 · **§7.73** |
| **8.19** | 2026-07-26 | First real coach marking on prod (4 bugs fixed); lesson lists gained a marking status | **§7.64–§7.68** · `docs/plans/COACH_ATTENDANCE_STATUS_PLAN.md` · PRD §7.6, §14.3 |
| **8.18** | 2026-07-26 | Worktree protocol + 2 skills; 9 missing fixture teardowns + a CI guard | `docs/WORKTREES.md` · `docs/TESTING.md` §5 · **§7.62, §7.63** |
| **8.17** | 2026-07-26 | Documents became an index: HANDOVER 3,972 → ~460 lines; ledger never FIFO-capped | **§7.56, §7.61** · `docs/DEPLOYMENT.md` **§11.5, §11.6** |
| **8.16** | 2026-07-26 | Root markdown 22 → 8 files; auth redirect allow-list found broken in prod | `README.md` → *Where everything lives* · **§7.41** |
| **8.15** | 2026-07-26 | Marking window became a DB rule; a mid-month joiner no longer blocks billing | `docs/plans/ATTENDANCE_WINDOW_PLAN.md` · PRD §7.5, §7.6 · §7.57–§7.60 |
| **8.14** | 2026-07-26 | A parent's contact details can be fixed — deployed | `docs/plans/CONTACT_DETAILS_PLAN.md` · PRD §7.19 |
| **8.13** | 2026-07-26 | Two admin UI changes; the skill workflow reworked (`/session-close` → `/update-docs`) | `01_SESSION_WORKFLOW.md` · §7.54 |
| **8.12** | 2026-07-26 | Parents can claim their own child — deployed | `docs/plans/PARENT_CLAIM_PLAN.md` · PRD §7.18 · §7.48 |
| **8.11** | 2026-07-25 | Class categories are mandatory; a trial is a booking — deployed | `docs/plans/TRIAL_BOOKINGS_PLAN.md` · PRD §7.17 |
| **8.10** | 2026-07-25 | A child can exist before their parent — deployed | `docs/plans/TRIAL_ONBOARDING_PLAN.md` · PRD §7.17 · §7.42, §7.43 |
| **8.9** | 2026-07-21 | A business can be created in-app — deployed | `docs/plans/TENANT_PROVISIONING_PLAN.md` · PRD §4.4 |
| **8.8** | 2026-07-20 | Prepaid lesson packages — deployed | `docs/design/PACKAGES_DESIGN.md` · PRD §7.16 |
| **8.7** | 2026-07-19 | The platform admin gets their own panel — deployed | PRD §4.4 · BACKLOG *(tenants.kind, impersonation)* |
| **8.6** | 2026-07-19 | A billing month must have ENDED before it can be billed — deployed | PRD §7.7 · §7.32 · BACKLOG *(no override)* |
| **8** *(5th)* | 2026-07-19 | Child identity (name + DOB), coach-defined levels, family address — deployed, with an incident | PRD §5.1, §7.15 · §7.31 |
| **8.4** | 2026-07-19 | Active / inactive for families and children, all six phases — live | PRD §7.14 · **§7.61** |
| **8.3** | 2026-07-19 | A lesson is priced and paid by **its own date** (effective dating) | PRD §7.3, §7.13 · BACKLOG *(substitute coaches)* |
| **8.2** | 2026-07-19 | The SwimSync logo | `brand/README.md` · BACKLOG *(collisions; the mark is not on the invoice)* |
| **8.1** | 2026-07-19 | Multi-tenancy, phases 0–5 — live | `docs/design/TENANCY_DESIGN.md` · `docs/plans/TENANCY_PLAN.md` · PRD §4.3 |
| **8a** | 2026-07-18 | The underbilling cluster: multi-class fix, run day, sealing, hard block (+ §8a.1, the empty-month seal) | PRD §7.7 · `INVOICE_RUNBOOK.md` · BACKLOG |
| **8b** | 2026-07-17 | UTC-derived default billing month fixed (the `APP_TIMEZONE` seam) | §7.12 · BACKLOG *(per-tenant timezone)* |
| **8c** | 2026-07-17 | Attendance marking window (UI only) + truthful parent empty states | **superseded by §8.15** · PRD §7.5, §7.6 |
| **8d** | 2026-07-16 | Invoice email notifications via Resend | PRD §7.7 · BACKLOG *(credit-note emails, delivery tracking)* |
| **8e** | 2026-07-16 | Typecheck baseline + CI guard | §7.11 · BACKLOG *(generate real `Database` types)* |
| **8f** | 2026-07-16 | Bulk "Set all" attendance, admin class management, backlog ranking | PRD §7.6 · BACKLOG → *Build order* |
| **8g** | 2026-07-16 | Six future features recorded in BACKLOG; no code | BACKLOG · §7.56 |
| **8h** | 2026-07-16 | Parent Attendance screen fixed; the branch's first production deploy | PRD §5.1 · §7.9 · §7.56 |
| **8i** | 2026-07-16 | The docs split into three (PRD / BACKLOG / HANDOVER) | `README.md` · `01_SESSION_WORKFLOW.md` |
| **8j** | 2026-07-15 | Closed the silent-underbilling hole; fixed the SGT/UTC double-billing bug | §7.7 · PRD §7.5 |
| **8k** | 2026-07-13 → 14 | Custom domains, production email, clean-slate prod DB, first real coach onboarded | `docs/DEPLOYMENT.md` §11 |
| **8l** | 2026-07-12 | Password reset end to end + auth error mapping | PRD §7.1 |
| **8m** | 2026-07-11 | Credit-note ledger fix (`credit_applications`), PayNow QR, the first test suites | PRD §5.6, §9.17 |
