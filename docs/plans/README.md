# docs/plans — index

**Plans stay in this folder forever, done or not.** They are cited by path ~200 times — 45 of those from 38 applied
migrations, which can never be edited — so moving a finished plan breaks links nobody can repair. This table is the
done / not-done split instead.

**The rule:** a new plan gets a row here **the day it is written** (status `NOT STARTED`), and the row is updated in the
same commit that ships it. A plan's own header line is a hint that has often drifted (eight were found stale on
2026-09-27); this table, checked against `docs/SESSIONS.md`, is the fact.

**Naming:** `WAVE_1_PLAN.md` / `WAVE_2_PLAN.md` are the *August 2026* waves (done). The 2026-09-27 build order's
"Wave 1 / Wave 2" are different — their files are named for the feature (`ROLES_…`, `CRASH_SAFE_…`, `WAVE_2_PACKAGES_BRIEF`).

Statuses: `NOT STARTED` · `IN PROGRESS` · `DONE` · `DONE (partly superseded)` · `SUPERSEDED` · `REFERENCE`.

## Not done

| Plan | Status | What it is |
|---|---|---|
| ROLES_PERMISSIONS_PLAN.md | DONE (§8.131, deploy #58; P5 half — see BACKLOG) | Wave 1 lane 1 — owner-defined roles × 8 areas × None/View/Edit |
| ROLES_ENFORCEMENT_MAP.md | CURRENT | Step 0 of the roles plan — every admin-gated policy/function/route → area + level |
| CRASH_SAFE_EMAIL_CLAIM_PLAN.md | DONE (§8.131, deploy #57) | Wave 1 lane 2 — claim lease + Resend idempotency key; no auto-retry after 24 h |
| PACKAGE_REVENUE_REFUNDS_PLAN.md | DONE (§8.132, deploy #59) | Wave 2 — package revenue on Accounting (cash basis) + in-app refunds |
| TEST_DATE_EXPIRY_ALARM_PLAN.md | DONE (2026-10-01; clock → BACKLOG) | CI alarm for literal test dates the marking floor will pass (§7.303); injected clock → BACKLOG |
| WAVE_2_PACKAGES_BRIEF.md | SUPERSEDED by PACKAGE_REVENUE_REFUNDS_PLAN.md | Wave 2's decisions W1–W6 (still the source for those) |
| ATTENDANCE_SAVE_TESTS_PLAN.md | DONE (§8.134, deploy #60) | Wave 2 lane 2 — the attendance save path's hook + screen tests |
| WAVE3_RENDER_TESTS_PLAN.md | DONE (§8.137, deploy #63) | Wave 3 — two lanes: admin invoice/Pending-charges tests; parent money cards + the D5 child-card fix |
| WAVE7_DB_CLOCK_PLAN.md | DONE (§8.140, deploys #74–#76) | Wave 7 — the injectable DB clock (`app_now()`/`app_today()`), 83 pgTAP files pinned, guards G1–G4 |
| WAVE8_GENERATED_TYPES_PLAN.md | DONE (§8.141, deploys #77–#78) | Wave 8 — generated Supabase `Database` types in both apps, DB `any`s removed, guards G5/G6 + runtime-identity; Bug ledger #1–#5 |
| PIN_DRIVER_CLOCK_PLAN.md | DONE except step 5 — engine v35 on prod (deploy #81), proof = the next real Generate (§8.144) | Pin the clock for UI drivers — `run-all-drivers.sh --now`: browser + PostgREST (local-only lock-2 row) + engine reads `app_now()`; full driver sweep |
| SINGLE_CHILD_PACKAGES_PLAN.md | NOT STARTED (approved 2026-10-10, hardened by /plan-review) | Wave 9 — a package product can be one-child only (Little Orcas); per-child draw, offers, picker |

## Done

_Audited 2026-09-27 against SESSIONS / BACKLOG / git / migrations (every migration any plan names is on prod)._

| Plan | Status | Shipped |
|---|---|---|
| ACCOUNTING_PAGE_PLAN.md | DONE | §8.87 |
| ADD_STUDENT_DUP_WARNING_PLAN.md | DONE | §8.56, `20260814000200` |
| ADMIN_CALENDAR_PLAN.md | DONE (partly superseded) | §8.71 — "Book anyway" replaced by the capacity hard limit |
| ATTENDANCE_WINDOW_DRIVER_FOLD_PLAN.md | DONE | §8.21 |
| ATTENDANCE_WINDOW_PLAN.md | DONE | §8.15, `20260727000100` |
| BILLING_MONTHS_PLAN.md | DONE | §8.117, `20260922000100` |
| CAPACITY_HOLIDAY_BADGE_PLAN.md | DONE | §8.73, `20260820000100`–`300` |
| CLASS_SHADOW_COACHES_PLAN.md | DONE | §8.46, `20260812000200` |
| COACH_ATTENDANCE_STATUS_PLAN.md | DONE | §8.19 |
| CONTACT_DETAILS_PLAN.md | DONE | §8.14 |
| CREDIT_NOTE_AND_MARKABLE_FLOOR_PLAN.md | DONE | §8.69, `20260818000200`/`300` |
| CREDIT_NOTE_EMAIL_PLAN.md | DONE | §8.64, `20260817000100` |
| DRIVER_BACKLOG_PLAN.md | DONE | §8.128 |
| ENGINE_TENANT_RUN_DAY_PLAN.md | DONE | §8.119 |
| GRADING_ADMIN_ONLY_PLAN.md | DONE | §8.93/§8.94, `20260829000100` |
| INVOICE_EMAIL_RETRY_PLAN.md | DONE | §8.63 — its ⚠ RISK 1 residual is the *Crash-safe email claim* backlog item |
| LOCATION_ENTITY_PLAN.md | DONE | §8.88 expand + §8.89 contract |
| PACKAGE_RENEWAL_AUTOMATION_PLAN.md | DONE | §8.60 |
| PACKAGE_WEEKS_HOLIDAYS_PLAN.md | DONE (partly superseded) | §8.59 — calendar-scan holiday extension replaced by event-driven marking (§8.70) |
| PARENT_CLAIM_PLAN.md | DONE | §8.12 |
| PARTIAL_PAYMENT_PLAN.md | DONE | `20260822000100`; folded re-correction refused (*Deliberately not doing*) |
| PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md | DONE | §8.84, `20260822000200` — RISK 6 two-tenant component test never written (see note) |
| REFERRAL_PLAN.md | DONE | §8.61, `20260815000700` |
| SGT_DISPLAY_PLAN.md | DONE | §8.98 |
| SMALL_ITEMS_PLAN.md | DONE | §8.53 |
| STUDENT_RENAME_PLAN.md | DONE | §8.54, `20260814000100` |
| TENANCY_PLAN.md | DONE | §8.1 |
| TENANT_PROVISIONING_PLAN.md | DONE | §8.9, `20260721000100` |
| TRIAL_BOOKINGS_PLAN.md | DONE | §8.11 |
| TRIAL_ONBOARDING_PLAN.md | DONE (partly superseded) | §8.10 — trial half replaced by TRIAL_BOOKINGS |
| UNMARKED_BOOKING_PLAN.md | DONE | §8.57 |
| UPCOMING_LESSONS_COMPLETE_PLAN.md | DONE | `20260821000700` |
| WAVE_1_PLAN.md | DONE | §8.36–§8.38 |
| WAVE_2_PLAN.md | DONE | §8.43, `20260811000100` |
| WAVE_3_PLAN.md | DONE | §8.44, `20260811000200` |
| WAVE_3_FOLLOWUP_PLAN.md | SUPERSEDED | §8.45 shipped, guard deleted a day later by §8.46 |
| WAVE_5_PLAN.md | DONE | §8.49–§8.51 |
| WAVE_C_PLAN.md | DONE | §8.66 |
| WAVE_C_SPOOL_PLAN.md | DONE | Pieces 1–5, 2026-08-28 → 2026-08-30 |
| WAVE_D_PLAN.md | DONE | §8.68/§8.69; Track 4 (HANDOVER §3 graduation) done 2026-08-22 per BACKLOG |
| HOLIDAY_ATTENDANCE_RUNBOOK.md | REFERENCE (historical) | a one-shot deploy runbook, executed in §8.70 |

**One loose end found by the audit:** PARTIAL_PAYMENT_FOLLOWUPS' RISK 6 (a two-tenant render test of the *Pending
charges* panel) was deferred for lack of a component-render harness. The harness now exists (`2961999`); the test
does not. It belongs to *Deeper component-render tests* (Wave 3). **Closed 2026-10-05** by
WAVE3_RENDER_TESTS_PLAN (§8.137).
