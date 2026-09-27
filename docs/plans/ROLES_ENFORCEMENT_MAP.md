# Roles & permissions — enforcement map (step 0)

> Generated 2026-09-27 from the **live local database** (`pg_policies`, `pg_proc.prosrc`), not by grep of migrations
> (plan §8 risk 1). Parent plan: `ROLES_PERMISSIONS_PLAN.md` §6 step 0. Base: `main` @ `ee688d9` (includes lane 2's
> `20260927000100`, which adds no admin arm).
>
> **Regenerate before each of migrations B–D** and diff against this file — a site added after today is not here.
> The queries are at the bottom.

**Counts:** 65 `public` policies + 3 `storage` policies reference `is_tenant_admin` / `is_tenant_owner` /
`can_admin_tenant`; 55 functions do (49 gated RPCs + 3 helpers + 2 triggers + 1 wrapper). Plus 5 functions and 2
policies that test the `'tenant_admin'` literal without a helper, 15 admin API routes, 2 edge functions, 2 coach-app
sites. (The plan's "68 policies" = 65 + 3 storage.)

**Level rule (plan §5.3):** a SELECT arm → `view`; an INSERT/UPDATE/DELETE arm → `edit`. **An `ALL` policy is split**
into a SELECT policy (`view`) and a write policy (`edit`) — an `ALL` policy's USING also admits SELECT, so leaving it
whole would let `view` holders write or `edit`-only checks hide rows. Non-admin arms (`coach_*`, `parent_*`,
`current_tenant_id()`) are untouched (D6, P8).

The **Q** column once flagged rows that depended on an open question; all four (X1–X4) are decided in §6.

## 1. Policies — `operations` and `profile`

| Table | Policy | Cmd | Area → level | Q | Notes |
|---|---|---|---|---|---|
| attendance | attendance_select | SELECT | operations → view | | coach arms stay |
| attendance | attendance_write | ALL | operations → edit (split) | | main-coach arm stays |
| audit_log | audit_log_insert | INSERT | operations → edit | | entity_type = lesson_session only |
| audit_log | audit_log_select | SELECT | operations → view | | Change History page |
| lesson_sessions | sessions_select | SELECT | operations → view | | |
| lesson_sessions | sessions_write | ALL | operations → edit (split) | | coach_owns_class arm stays |
| makeup_bookings | makeup_bookings_insert / _update | INSERT / UPDATE | operations → edit | | |
| trial_bookings | trial_bookings_insert / _update | INSERT / UPDATE | operations → edit | | |
| tenant_public_holidays | tenant_public_holidays_select | SELECT | operations → view | | |
| tenant_public_holidays | tenant_public_holidays_write | ALL | operations → edit (split) | | |
| students | students_select | SELECT | operations → view | | |
| students | students_insert / students_update | INSERT / UPDATE | operations → edit | | |
| student_class_enrolments | enrolments_select | SELECT | operations → view | | |
| student_class_enrolments | enrolments_write | ALL | operations → edit (split) | | |
| student_claims | student_claims_select | SELECT | operations → view | | |
| student_skill_progress | student_skill_progress_write | ALL | operations → edit (split) | | Assessment page |
| skill_grade_levels | skill_grade_levels_write | ALL | operations → edit (split) | | Assessment page |
| profiles | profiles_update | UPDATE | parent profiles → operations:edit; staff profiles → admins:edit | | P12 — the arm splits by target role |
| classes | classes_select | SELECT | operations → view | | |
| classes | classes_write | ALL | operations → edit (split) | | a priced INSERT also needs pricing:edit (§5.3 2b, `seed_class_rate`) |
| class_categories | class_categories_write | ALL | operations → edit (split) | | |
| locations | locations_write | ALL | operations → edit (split) | | |
| tenant_levels | tenant_levels_write | ALL | operations → edit (split) | | |
| tenant_level_skills | tenant_level_skills_write | ALL | operations → edit (split) | | |
| coaches | coaches_update | UPDATE | operations → edit | | coach-name reads are `current_tenant_id()` (D6) — untouched |
| class_shadow_coaches | _select / _write | SELECT / ALL | operations → view / edit | | |
| session_coaches | _select / _write | SELECT / ALL | operations → view / edit | | |
| session_coach_absences | _select / _write | SELECT / ALL | operations → view / edit | | |
| tenants | tenants_update | UPDATE | **per-column trigger** (§5.3 1) | | profile / billing / wages / packages / nobody |

## 2. Policies — money areas

| Table | Policy | Cmd | Area → level | Q | Notes |
|---|---|---|---|---|---|
| class_rates | class_rates_admin | ALL | pricing → view / edit (split) | | |
| class_rate_overrides | class_rate_overrides_admin | ALL | pricing → view / edit (split) | | |
| trial_rates | trial_rates_insert | INSERT | pricing → edit | | |
| invoices | invoices_select | SELECT | billing → view | | **X3: coach read arm removed** |
| invoices | invoices_update | UPDATE | billing → edit | | **P11: coach arm removed** (no column grant — table_grants assertion 6 forbids it) |
| invoice_items | invoice_items_select | SELECT | billing → view | | |
| credit_notes | credit_notes_select | SELECT | billing → view | | |
| credit_applications | credit_applications_select | SELECT | billing → view | | |
| payment_records | payment_records_select | SELECT | billing → view | | **X3: coach read arm removed** |
| payment_records | payment_records_insert | INSERT | billing → edit | | **P11: coach arm removed** |
| student_settlements | _select / _insert / _update | SELECT / INSERT / UPDATE | billing → view / edit | | |
| billing_periods | billing_periods_select | SELECT | **any active admin** (unchanged) | | X2: month state, not money |
| billing_runs | billing_runs_select | SELECT | **any active admin** (unchanged) | | X2: month state, not money |
| storage.objects | paynow_qr_tenant_insert / _update / _delete | INSERT / UPDATE / DELETE | billing → edit | | platform-admin arm stays (P7) |
| package_products | package_products_write | ALL | packages → edit (split) | | |
| parent_packages | _select / _insert / _update | SELECT / INSERT / UPDATE | packages → view / edit | | |
| package_applications, package_cancel_extensions, package_extension_events, package_holiday_extensions | *_select | SELECT | packages → view | | |
| referrals, referral_rewards | *_select | SELECT | packages → view | | |
| coach_rates | coach_rates_admin | ALL | wages → view / edit (split) | | |
| coach_payouts | _select / _write | SELECT / ALL | wages → view / edit | | coach reads own payout — arm stays |
| coach_payout_items | coach_payout_items_select | SELECT | wages → view | | |
| session_pay_overrides | session_pay_overrides_admin | ALL | wages → view / edit (split) | | |

## 3. Functions (RPCs and triggers)

| Function | Today | Area → level | Notes |
|---|---|---|---|
| cancel_lesson, restore_lesson, schedule_extra_lesson | admin | operations → edit | D8: cancel still extends packages |
| mark_day_holiday, unmark_day_holiday | can_admin | operations → edit | |
| enforce_holiday_admin_only *(trigger)* | can_admin | operations → edit | |
| book_makeup, book_trial, cancel_makeup_booking, cancel_trial_booking | admin | operations → edit | |
| tenant_unmarked_lesson_count | can_admin | operations → view | dashboard tile |
| unbilled_sealed_lessons | can_admin | operations → view | |
| add_unclaimed_student | admin | operations → edit | called from Trials AND Students pages |
| approve_ / decline_ / undo_student_claim | admin | operations → edit | |
| list_student_claims | admin | operations → view | |
| close_student_enrolment, set_students_active, set_parent_tenant_active | admin | operations → edit | |
| rename_student, merge_students, link_invited_parent | admin | operations → edit | |
| find_roster_duplicates | admin | operations → view | |
| tenant_admin_has_member *(RLS helper)* | admin | operations → view | parents/profiles read arm |
| deactivate_class, reactivate_class | admin | operations → edit | |
| set_class_terms | can_admin | **additive split** (§5.3 2) | pricing:edit if the rate changes; operations:edit if coach / schedule / title change |
| assign_class_shadow, end_class_shadow, assign_session_coach, set_session_main_coach | can_admin | operations → edit | |
| disable_coach, reactivate_coach | admin | operations → edit | |
| regenerate_join_code | can_admin | profile → edit | |
| deactivate_admin, reactivate_admin, prepare_admin_delete, remove_admin_role | owner | admins → edit | + owner-target refusal + escalation guard (§5.4) |
| confirm_invoice_paid | can_admin | billing → edit | **P11: coach arm removed** |
| void_credit_note, write_off_parent_balance | admin | billing → edit | |
| create_package_offer, extend_package, grant_referral_reward, void_referral_reward, set_referral_code_disabled | can_admin | packages → edit | |
| preview_package_price | can_admin | packages → view | |
| enforce_parent_package_lifecycle *(trigger)* | can_admin | packages → edit | |
| generate_coach_payouts, mark_payout_paid | can_admin | wages → edit | |
| accounting_summary, accounting_months | owner | accounting → view | owner passes by D1 |
| is_tenant_admin, is_tenant_owner, can_admin_tenant | — | helpers — unchanged | `has_admin_area` builds on `is_tenant_admin` |
| handle_new_user | literal | sets + validates `admin_role_id` from invite metadata | §5.1 |
| platform_reassign_owner | literal | old owner → *Full admin* (P6) | step 4 |
| platform_tenant_admins, platform_tenant_overview | literal | unchanged (platform only) | P7 |
| parents_select, profiles_select *(policies)* | literal via `tenant_admin_has_member` | operations → view | |

## 4. Admin API routes (`SwimSyncAdmin/app/api/`)

| Route | Gate today | Becomes |
|---|---|---|
| invite-admin, resend-admin-invite, deactivate-admin, reactivate-admin, delete-admin | `requireOwner` | `requireArea('admins','edit')` + escalation / owner-target rules (§5.4) |
| list-admins | `requireActiveAdmin` | `requireArea('admins','view')` |
| create-coach | `role === 'tenant_admin'` — **admits a deactivated admin** | `requireArea('coaches','edit')` (P9) |
| generate-invoices | `role === 'tenant_admin'` (or CRON_SECRET / platform) — **admits a deactivated admin** | `requireArea('billing','edit')` (P9); CRON_SECRET + platform unchanged |
| disable-coach, reactivate-coach | `requireActiveAdmin` + RPC as caller | RPC gate carries it (operations:edit); route unchanged |
| invite-parent | RPC `link_invited_parent` as caller | RPC gate carries it (operations:edit) |
| resend-invite, provision-tenant, suspend-tenant, unsuspend-tenant | platform admin | unchanged (P7) |
| **resend-invoice-email** *(lane 2, new)* | born on `is_tenant_admin` | `billing:edit` — whichever lane lands second |

## 5. Edge functions and the coach app

| Site | Today | Becomes |
|---|---|---|
| `credit-note-emails` note path | `is_tenant_admin` | billing → edit |
| `credit-note-emails` session path | admin OR main coach | operations:edit OR main coach |
| `package-emails` offered / referral reward | `can_admin_tenant` | packages → edit |
| `generate-invoices/email.ts` `notifyGenerationBlocked` | every coach + tenant_admin | coaches + owner + admins with operations:edit (X4) |
| `SwimSyncApp/features/coach-settings` PayNow editor | `role === 'tenant_admin'`, ignores deactivation | billing → edit via `my_admin_permissions` |
| `SwimSyncApp/lib/landing.ts` | routes `tenant_admin` home | unchanged (routing, not a permission) |

## 6. Decisions on the ambiguous rows (user, 2026-09-27)

- **X1 — Cross-cutting ops reads → the four ops areas are MERGED into one area, `operations`.** Attendance, Students,
  Classes and Coaches read each other's tables, so the user ruled that an unworkable combination must not be settable.
  Plan §3 now has 8 areas. Money pages also show child and class names, so **any role above None anywhere must have
  `operations` ≥ View** (editor + `update_role_permissions` enforce it).
- **X2 — `billing_periods` / `billing_runs` reads stay open to any active admin** (`is_tenant_admin`, unchanged). Month
  state, not an amount; the dashboard tile and the roster need it.
- **X3 — The coach READ arm on `invoices` / `payment_records` is removed** along with P11's write arm. Step 1 confirms
  first that the coach app's invoice reads (`features/invoice-detail`, `paynow`, `child-profile`, `parent-home`,
  `billing`) are all parent-side.
- **X4 — `notifyGenerationBlocked` goes to coaches + the owner + co-admins with `operations:edit`** (the people who can
  fix the marking). Others drop off.

## Queries

```sql
-- policies
SELECT tablename, policyname, cmd FROM pg_policies
 WHERE schemaname IN ('public','storage')
   AND (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ '(is_tenant_admin|is_tenant_owner|can_admin_tenant|tenant_admin)';
-- functions
SELECT p.proname, pg_get_function_identity_arguments(p.oid) FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosrc ~ '(is_tenant_admin|is_tenant_owner|can_admin_tenant|''tenant_admin'')';
```
