// TWIN FILE: SwimSyncAdmin/lib/tierBoundaries.drift.test.ts is the admin fence.
// This is the COACH/PARENT APP's, and it is deliberately NOT a byte-for-byte twin
// (unlike sgDisplay.drift.test.ts) — three checks had to be rewritten for Expo:
//
//   page (app/…)  →  ui  →  domain  →  dao  →  (PostgREST | rpc)
//
// Tier folders live OUTSIDE app/, in `features/<screen>/{ui,domain,dao}` —
// Expo Router makes every file under app/ a route (playbook §1). So the route
// files are listed in PAGES explicitly rather than derived from SCOPE_DIRS.
//
// Four checks:
//
//   1. No file in `ui/` imports from `dao/`.
//   2. No file in `dao/` imports React, react-native, expo-router, `ui/` or
//      `@/components`. (The admin's `^react(-dom)?` does NOT match
//      `react-native`; a dao that renders or navigates is wrong either way.)
//   3. No file outside `dao/` reaches the network: the supabase client, a
//      `fetch(` — OR an import of a `lib/` module that holds the client ITSELF
//      (`markableFloor`, `sessionMainCoach`, …). ⚠ That third leg is the app-
//      specific one: `fetchMarkableFloor()` imports `./supabase` inside lib/, so
//      a plain twin of the admin regex could never see a domain/ hook calling
//      it. The set is DERIVED at test time (every non-test lib/*.ts importing
//      `./supabase` or `@/lib/supabase`), so a new client-holding helper is
//      fenced the day it is written, not the day someone remembers to list it.
//      One level only — a lib/ helper importing another client-holding helper
//      is not followed.
//   4. A route file is composition: it imports its own feature's tiers, React,
//      react-native, expo-router, @expo/vector-icons and `@/components/*` —
//      never `@/lib/*`, never `@/store/*` (the store is read in domain/ only,
//      settled 2026-09-21 at /plan-with-confidence), never `…/dao`.
//
// THE ALLOWLIST IS A DEBT LEDGER, NOT AN EXEMPTION — same rule as the admin
// file: pinned by file AND content snippet, never file-level; the "unused
// entries" test fails on any entry that no longer matches, so it only shrinks.
// Never add an entry after the unit's Stage 0b.
//
// SCOPE: the coach roster screen (full track, docs/refactor/
// COACH_ROSTER_REFACTOR_PLAN.md), 2026-09-21 Stage 0b — the first app unit.
// + the coach attendance MARKING screen (full track, docs/refactor/
// COACH_ATTENDANCE_REFACTOR_PLAN.md), 2026-09-22 Stage 0b.
// + the coach SCHEDULE landing tab (full track, docs/refactor/
// COACH_SCHEDULE_REFACTOR_PLAN.md), 2026-09-22 Stage 0b — the last app giant.
// + EVERY remaining route file — App L-F / L-G / L-H (13 lite screens) and the
// app fence track (11 routes), 2026-09-23 L0 (docs/refactor/BATCH_FGH_PLAN.md).
// After that batch lands, every route file in the app is in PAGES.
//
// §7.25: every check was proven RED by breaking the rule on purpose, then
// reverted. Roster Stage 0b, 2026-09-21: with the ledgers emptied, checks 3
// and 4 went red on exactly the 9 + 9 violations pre-agreed at plan-review.
// Then, ledgers pinned: features/roster/ui/Break importing ../dao (check 1);
// dao/break importing react, react-native AND expo-router (check 2, all three
// named); domain/break importing @/lib/markableFloor and calling fetch( (check
// 3, both named — the helper leg is live); unpinned @/lib/timeOfDay and
// @/store/other on the route (check 4). The same run proved the infra lines:
// domain/zz.test.ts failing proves jest's testMatch reaches features/, and a
// toLocaleDateString() in domain/break went red in BOTH sgDisplay twins. A
// typo'd PAGES path turned the scan test red (not a TypeError), and
// corrupting the makeup_bookings pin turned the shrink test AND check 3 red.
// Breakers removed, 7/7 green.
//
// Schedule Stage 0b, 2026-09-22: with the new pins emptied, checks 3 and 4
// went red on exactly 12 + 12 sites (the plan's prediction, confirmed by
// plan-review's simulation). Then, pinned: schedule/ui/Break importing
// ../dao (1); dao/break importing expo-router (2); domain/break importing
// @/lib/markableFloor AND calling fetch( (3, both named); an unpinned
// @/lib/confirm on the route (4 — timeOfDay is already imported there); a
// failing domain/zz.test.ts ran; a toLocaleDateString() in domain/break went
// red in BOTH sgDisplay twins; a corrupted trial_bookings pin turned the
// shrink test AND check 3 red; a typo'd PAGES path and a SCOPE_DIRS/PAGES
// length mismatch each turned the scan test red. And EACH of the 24 pins,
// removed alone, left exactly ONE offender — no pin covers two sites.
// Breakers removed, 7/7 green.
//
// Attendance Stage 0b, 2026-09-22: with the new pins emptied, checks 3 and 4
// went red on exactly 20 + 14 sites (the plan-review's corrected count). Then,
// pinned: mark-attendance/ui/Break importing ../dao (1); dao/break importing
// react-native (2); domain/break importing @/lib/sessionMainCoach AND calling
// fetch( (3, both named); an unpinned @/lib/timeOfDay on the route (4); a
// failing domain/zz.test.ts ran (testMatch reaches the folder); a
// toLocaleDateString() in domain/break went red in BOTH sgDisplay twins; a
// corrupted trial_bookings pin turned the shrink test AND check 3 red; a
// typo'd PAGES path and a SCOPE_DIRS/PAGES length mismatch each turned the
// scan test red (not a TypeError). Breakers removed, 7/7 green.
//
// App L-F/G/H L0, 2026-09-23: PAGES restructured from two index-paired lists
// into {page, feature|null} (two routes may share a feature; `null` = no
// tiers), SCOPE_DIRS derived as the SET of features, and a new test that no
// features/ folder is orphaned from PAGES. BEFORE any new route was added,
// with the three giants only, every check re-proved red: ui/Break -> ../dao
// (1); dao/break -> react-native (2); domain/break importing
// @/lib/markableFloor AND calling fetch( (3, both lines named); an unpinned
// @/lib/confirm on the schedule route (4); the roster route importing
// @/features/schedule/ui (4 — another feature's tier); a features/zzorphan
// folder (orphan test); a PAGES feature with no folder, and the STRING "null"
// (scan test); welcome as feature:null went green, then red on importing
// @/features/schedule/ui (4 — the null branch has no features/ leg); a
// toLocaleDateString() in domain/break red in BOTH sgDisplay twins; a failing
// features/roster/domain/zz.test.ts ran. (The old length-mismatch proof no
// longer exists — the lists are no longer paired.) Then the 24 routes were
// added with empty ledgers: checks 3 and 4 went red on exactly 107 + 76 sites,
// the plan's prediction. Pinned as 99 + 76 entries: 7 check-3 entries each
// cover several sites whose text contains the snippet (named in each `why`);
// every entry, removed alone, left exactly its named sites. Breakers removed,
// 8/8 green.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// This file lives in SwimSyncApp/lib, so the app root is one level up.
const APP = join(__dirname, "..");

// The route files, each with the features/<name> it composes. Check 4 runs
// against each; check 3 scans them too. Two routes MAY share a feature (both
// change-password routes compose features/change-password); `feature: null`
// is a route with no tiers at all (welcome) — check 4 then allows only React,
// RN, expo-router, icons and @/components. Restructured from two index-paired
// lists at App L-F/G/H L0, 2026-09-23 (docs/refactor/BATCH_FGH_PLAN.md).
type Page = { page: string; feature: string | null };

const PAGES: Page[] = [
  // Coach roster (full track), 2026-09-21.
  { page: "app/(coach)/classes/[id]/roster.tsx", feature: "roster" },
  // Coach attendance marking (full track), 2026-09-22.
  { page: "app/(coach)/classes/[id]/attendance.tsx", feature: "mark-attendance" },
  // Coach Schedule, the landing tab (full track), 2026-09-22.
  { page: "app/(coach)/schedule/index.tsx", feature: "schedule" },
  // App L-F/G/H + the app fence, 2026-09-23 L0 (docs/refactor/BATCH_FGH_PLAN.md).
  // Sub-batch F — parent home.
  { page: "app/(parent)/home/index.tsx", feature: "parent-home" },
  { page: "app/(parent)/home/add-child.tsx", feature: "add-child" },
  { page: "app/(parent)/home/child/[id].tsx", feature: "child-profile" },
  { page: "app/(parent)/home/edit-child.tsx", feature: "edit-child" },
  // Sub-batch G — parent money.
  { page: "app/(parent)/billing/index.tsx", feature: "billing" },
  { page: "app/(parent)/billing/invoice/[id].tsx", feature: "invoice-detail" },
  { page: "app/(parent)/billing/paynow.tsx", feature: "paynow" },
  { page: "app/invoice/[token].tsx", feature: "public-invoice" },
  { page: "app/package/[token].tsx", feature: "public-package" },
  // Sub-batch H — the rest.
  { page: "app/(parent)/attendance/index.tsx", feature: "parent-attendance" },
  { page: "app/(coach)/settings/index.tsx", feature: "coach-settings" },
  { page: "app/(coach)/classes/index.tsx", feature: "coach-classes" },
  { page: "app/(auth)/register.tsx", feature: "register" },
  // The fence sub-batch.
  { page: "app/(auth)/login.tsx", feature: "login" },
  { page: "app/(auth)/accept-invite.tsx", feature: "accept-invite" },
  { page: "app/(auth)/reset-password.tsx", feature: "reset-password" },
  { page: "app/(auth)/forgot-password.tsx", feature: "forgot-password" },
  { page: "app/(coach)/classes/[id]/grade.tsx", feature: "grade" },
  { page: "app/(coach)/pay/index.tsx", feature: "coach-pay" },
  { page: "app/(parent)/profile/index.tsx", feature: "profile" },
  { page: "app/(parent)/profile/contact.tsx", feature: "contact" },
  { page: "app/(parent)/home/join-tenant.tsx", feature: "join-tenant" },
  { page: "app/(parent)/profile/change-password.tsx", feature: "change-password" },
  { page: "app/(coach)/settings/change-password.tsx", feature: "change-password" },
  { page: "app/welcome.tsx", feature: null },
];

// The folders checks 1-3 walk: the SET of named features, so a shared one is
// walked once. ⚠ Derived from PAGES — so a features/<x> folder no route names
// would never be scanned. The scan test asserts there is no such folder.
const FEATURES = [...new Set(PAGES.flatMap((p) => (p.feature === null ? [] : [p.feature])))];
const SCOPE_DIRS = FEATURES.map((f) => `features/${f}`);

type Allowed = { file: string; contains: string; why: string };

// (F_ROSTER was deleted with its last ledger entry, roster Stage 5, 2026-09-21.)
// (F_ATT was deleted with its last ledger entry, attendance Stage 6, 2026-09-22.)
// (F_SCHED was deleted with its last ledger entry, schedule Stage 5, 2026-09-22.)

/**
 * Check 3 — network reaches outside `dao/`. APP L-F/G/H L0 (2026-09-23)
 * pinned 107 sites with 99 entries across the 24 routes; each `why` names the
 * sub-batch commit that removes it. The fence commit removes the last.
 *
 * SCHEDULE Stage 0b pinned 12: the
 * client import, two client-holding helper imports and nine `.from()`
 * builders — one pin each, no pin shared. All leave at Stage 3.
 *
 * ATTENDANCE Stage 0b pinned 20
 * sites with 19 entries: the client import, two client-holding helper
 * imports, 14 `.from()` builders, 2 `.rpc()` and `notifyCreditNoteEmails(
 * supabase, …)`. ⚠ ONE entry covers TWO lines — :314 (load) and :629 (save)
 * render identically once joined; see its `why`. Stage 3 removes the load's,
 * Stage 4 the save's and the client import.
 *
 * Roster Stage 0b pinned 9: the
 * client import, the six `.from()` builders, `removeFromClass(supabase, …)`,
 * and the `@/lib/markableFloor` import (a client-holding helper). Stage 3
 * removes the six `.from()` pins and the markableFloor import; Stage 4 the
 * client import and `removeFromClass`.
 */
const ALLOWED_DATA_ACCESS: Allowed[] = [
  { file: "app/(parent)/home/index.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "await supabase.rpc(\"dismiss_student_claim\", { p_claim_id: id });", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "supabase .rpc(\"student_package_coverage\")", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "const { data: parent } = await supabase .from(\"parents\")", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "supabase .from(\"trial_bookings\")", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "supabase .from(\"makeup_bookings\")", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "const { data: invoices } = await supabase .from(\"invoices\")", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "const { data: claims } = await supabase .from(\"student_claims\")", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "const { data: p } = await supabase .from(\"parents\")", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "const { data, error } = await supabase.rpc(\"join_tenant_by_code\", {", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/index.tsx", contains: "await supabase.from(\"parents\").update({ signup_join_code: null }).eq(\"id\", p.id);", why: "L-F commit parent-home: moves to features/parent-home/dao/" },
  { file: "app/(parent)/home/add-child.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-F commit add-child: moves to features/add-child/dao/" },
  { file: "app/(parent)/home/add-child.tsx", contains: "const { data } = await supabase .from(\"parent_tenants\")", why: "L-F commit add-child: moves to features/add-child/dao/" },
  { file: "app/(parent)/home/add-child.tsx", contains: "const { data, error } = await supabase.rpc(\"add_child_or_claim\", {", why: "L-F commit add-child: moves to features/add-child/dao/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-F commit child-profile: moves to features/child-profile/dao/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "supabase .rpc(\"student_package_coverage\")", why: "L-F commit child-profile: moves to features/child-profile/dao/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "const { data: student } = await supabase .from(\"students\")", why: "L-F commit child-profile: moves to features/child-profile/dao/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "const { data: parentStudentLink } = await supabase .from(\"parent_students\")", why: "L-F commit child-profile: moves to features/child-profile/dao/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "const { data: invoices } = await supabase .from(\"invoices\")", why: "L-F commit child-profile: moves to features/child-profile/dao/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "const { data: parentRecord } = await supabase .from(\"parents\")", why: "L-F commit child-profile: moves to features/child-profile/dao/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "supabase .from(\"skill_grade_levels\")", why: "L-F commit child-profile: moves to features/child-profile/dao/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "supabase .from(\"student_skill_progress\")", why: "L-F commit child-profile: moves to features/child-profile/dao/" },
  { file: "app/(parent)/home/edit-child.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-F commit edit-child: moves to features/edit-child/dao/" },
  { file: "app/(parent)/home/edit-child.tsx", contains: "const { data } = await supabase .from(\"students\")", why: "L-F commit edit-child: moves to features/edit-child/dao/" },
  { file: "app/(parent)/home/edit-child.tsx", contains: "const { error } = await supabase .from(\"students\")", why: "L-F commit edit-child: moves to features/edit-child/dao/" },
  { file: "app/(parent)/billing/index.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-G commit billing: moves to features/billing/dao/" },
  { file: "app/(parent)/billing/index.tsx", contains: "const { data, error } = await supabase.rpc(\"claim_invoice_paid\", {", why: "L-G commit billing: moves to features/billing/dao/" },
  { file: "app/(parent)/billing/index.tsx", contains: "const { data: parent } = await supabase .from(\"parents\")", why: "L-G commit billing: moves to features/billing/dao/" },
  { file: "app/(parent)/billing/index.tsx", contains: "supabase .from(\"invoices\")", why: "L-G commit billing: moves to features/billing/dao/" },
  { file: "app/(parent)/billing/index.tsx", contains: "supabase .from(\"credit_notes\")", why: "L-G commit billing: moves to features/billing/dao/" },
  { file: "app/(parent)/billing/index.tsx", contains: "supabase .from(\"parent_packages\")", why: "L-G commit billing: moves to features/billing/dao/ — ⚠ ONE entry, 3 sites (:202, :314, :341 — the snippet is contained in each); all leave in the same commit" },
  { file: "app/(parent)/billing/index.tsx", contains: "supabase.rpc(\"package_live_balances\"),", why: "L-G commit billing: moves to features/billing/dao/" },
  { file: "app/(parent)/billing/index.tsx", contains: "supabase .from(\"package_products\")", why: "L-G commit billing: moves to features/billing/dao/" },
  { file: "app/(parent)/billing/index.tsx", contains: "supabase.functions", why: "L-G commit billing: moves to features/billing/dao/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-G commit invoice-detail: moves to features/invoice-detail/dao/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "const { data, error } = await supabase.rpc(\"claim_invoice_paid\", {", why: "L-G commit invoice-detail: moves to features/invoice-detail/dao/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "const { data: inv } = await supabase .from(\"invoices\")", why: "L-G commit invoice-detail: moves to features/invoice-detail/dao/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "const { data: cns } = await supabase .from(\"credit_notes\")", why: "L-G commit invoice-detail: moves to features/invoice-detail/dao/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "? await supabase .from(\"package_applications\")", why: "L-G commit invoice-detail: moves to features/invoice-detail/dao/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "const { data: ls } = await supabase .from(\"lesson_sessions\")", why: "L-G commit invoice-detail: moves to features/invoice-detail/dao/" },
  { file: "app/(parent)/billing/paynow.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-G commit paynow: moves to features/paynow/dao/" },
  { file: "app/(parent)/billing/paynow.tsx", contains: "const { data: pkg } = await supabase .from(\"parent_packages\")", why: "L-G commit paynow: moves to features/paynow/dao/" },
  { file: "app/(parent)/billing/paynow.tsx", contains: "const { data: inv } = await supabase .from(\"invoices\")", why: "L-G commit paynow: moves to features/paynow/dao/" },
  { file: "app/invoice/[token].tsx", contains: "const res = await fetch(", why: "L-G commit public-invoice: moves to features/public-invoice/dao/ — ⚠ ONE entry, 2 sites (:65, :125 — the snippet is contained in each); all leave in the same commit" },
  { file: "app/package/[token].tsx", contains: "const res = await fetch(", why: "L-G commit public-package: moves to features/public-package/dao/ — ⚠ ONE entry, 2 sites (:77, :135 — the snippet is contained in each); all leave in the same commit" },
  { file: "app/(parent)/attendance/index.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-H commit parent-attendance: moves to features/parent-attendance/dao/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "const { data: parent } = await supabase .from(\"parents\")", why: "L-H commit parent-attendance: moves to features/parent-attendance/dao/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "const { data: links } = await supabase .from(\"parent_students\")", why: "L-H commit parent-attendance: moves to features/parent-attendance/dao/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "const { data } = await supabase .from(\"attendance\")", why: "L-H commit parent-attendance: moves to features/parent-attendance/dao/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "const { data: enrolments } = await supabase .from(\"student_class_enrolments\")", why: "L-H commit parent-attendance: moves to features/parent-attendance/dao/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "supabase .from(\"tenant_public_holidays\")", why: "L-H commit parent-attendance: moves to features/parent-attendance/dao/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "supabase .from(\"makeup_bookings\")", why: "L-H commit parent-attendance: moves to features/parent-attendance/dao/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "? supabase .from(\"lesson_sessions\")", why: "L-H commit parent-attendance: moves to features/parent-attendance/dao/ — ⚠ ONE entry, 2 sites (:284, :296 — the snippet is contained in each); all leave in the same commit" },
  { file: "app/(coach)/settings/index.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-H commit coach-settings: moves to features/coach-settings/dao/" },
  { file: "app/(coach)/settings/index.tsx", contains: "const { data } = await supabase .from(\"coaches\")", why: "L-H commit coach-settings: moves to features/coach-settings/dao/" },
  { file: "app/(coach)/settings/index.tsx", contains: "supabase .from(\"tenants\")", why: "L-H commit coach-settings: moves to features/coach-settings/dao/ — ⚠ ONE entry, 2 sites (:67, :156 — the snippet is contained in each); all leave in the same commit" },
  { file: "app/(coach)/settings/index.tsx", contains: "supabase .from(\"profiles\")", why: "L-H commit coach-settings: moves to features/coach-settings/dao/" },
  { file: "app/(coach)/settings/index.tsx", contains: "const bytes = await (await fetch(asset.uri)).arrayBuffer();", why: "L-H commit coach-settings: moves to features/coach-settings/dao/" },
  { file: "app/(coach)/settings/index.tsx", contains: "const { error: upErr } = await supabase.storage", why: "L-H commit coach-settings: moves to features/coach-settings/dao/" },
  { file: "app/(coach)/settings/index.tsx", contains: "const { data: pub } = supabase.storage", why: "L-H commit coach-settings: moves to features/coach-settings/dao/" },
  { file: "app/(coach)/settings/index.tsx", contains: "await supabase.auth.signOut();", why: "L-H commit coach-settings: moves to features/coach-settings/dao/" },
  { file: "app/(coach)/classes/index.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-H commit coach-classes: moves to features/coach-classes/dao/" },
  { file: "app/(coach)/classes/index.tsx", contains: "const { data: coach } = await supabase .from(\"coaches\")", why: "L-H commit coach-classes: moves to features/coach-classes/dao/" },
  { file: "app/(coach)/classes/index.tsx", contains: "const { data } = await supabase .from(\"classes\")", why: "L-H commit coach-classes: moves to features/coach-classes/dao/" },
  { file: "app/(auth)/register.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "L-H commit register: moves to features/register/dao/" },
  { file: "app/(auth)/register.tsx", contains: "const { data, error: signUpError } = await supabase.auth.signUp({", why: "L-H commit register: moves to features/register/dao/" },
  { file: "app/(auth)/register.tsx", contains: "await supabase .from(\"profiles\")", why: "L-H commit register: moves to features/register/dao/" },
  { file: "app/(auth)/register.tsx", contains: "await supabase .from(\"parents\")", why: "L-H commit register: moves to features/register/dao/" },
  { file: "app/(auth)/login.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit login: moves to features/login/dao/" },
  { file: "app/(auth)/login.tsx", contains: "const { data, error } = await supabase.auth.signInWithPassword({", why: "fence commit login: moves to features/login/dao/" },
  { file: "app/(auth)/login.tsx", contains: "supabase .from(\"profiles\")", why: "fence commit login: moves to features/login/dao/" },
  { file: "app/(auth)/login.tsx", contains: "supabase .from(\"coaches\")", why: "fence commit login: moves to features/login/dao/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit accept-invite: moves to features/accept-invite/dao/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "supabase.auth.getSession().then(async ({ data: { session } }) => {", why: "fence commit accept-invite: moves to features/accept-invite/dao/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "const { data: kids } = await supabase .from(\"students\")", why: "fence commit accept-invite: moves to features/accept-invite/dao/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "const { error: updErr } = await supabase.auth.updateUser({ password });", why: "fence commit accept-invite: moves to features/accept-invite/dao/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "const { data: me } = await supabase.auth.getUser();", why: "fence commit accept-invite: moves to features/accept-invite/dao/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "await supabase .from(\"profiles\")", why: "fence commit accept-invite: moves to features/accept-invite/dao/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "await supabase.auth.signOut();", why: "fence commit accept-invite: moves to features/accept-invite/dao/" },
  { file: "app/(auth)/reset-password.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit reset-password: moves to features/reset-password/dao/" },
  { file: "app/(auth)/reset-password.tsx", contains: "supabase.auth.getSession().then(({ data: { session } }) => {", why: "fence commit reset-password: moves to features/reset-password/dao/" },
  { file: "app/(auth)/reset-password.tsx", contains: "const { error: updErr } = await supabase.auth.updateUser({ password });", why: "fence commit reset-password: moves to features/reset-password/dao/" },
  { file: "app/(auth)/reset-password.tsx", contains: "await supabase.auth.signOut();", why: "fence commit reset-password: moves to features/reset-password/dao/" },
  { file: "app/(auth)/forgot-password.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit forgot-password: moves to features/forgot-password/dao/" },
  { file: "app/(auth)/forgot-password.tsx", contains: "const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {", why: "fence commit forgot-password: moves to features/forgot-password/dao/" },
  { file: "app/(coach)/classes/[id]/grade.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit grade: moves to features/grade/dao/" },
  { file: "app/(coach)/classes/[id]/grade.tsx", contains: "const { data: s } = await supabase .from(\"students\")", why: "fence commit grade: moves to features/grade/dao/" },
  { file: "app/(coach)/classes/[id]/grade.tsx", contains: "supabase .from(\"skill_grade_levels\")", why: "fence commit grade: moves to features/grade/dao/" },
  { file: "app/(coach)/classes/[id]/grade.tsx", contains: "supabase .from(\"student_skill_progress\")", why: "fence commit grade: moves to features/grade/dao/" },
  { file: "app/(coach)/pay/index.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit coach-pay: moves to features/coach-pay/dao/" },
  { file: "app/(coach)/pay/index.tsx", contains: "const { data: payoutRows } = await supabase .from(\"coach_payouts\")", why: "fence commit coach-pay: moves to features/coach-pay/dao/" },
  { file: "app/(coach)/pay/index.tsx", contains: "? await supabase .from(\"coach_payout_items\")", why: "fence commit coach-pay: moves to features/coach-pay/dao/" },
  { file: "app/(parent)/profile/index.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit profile: moves to features/profile/dao/" },
  { file: "app/(parent)/profile/index.tsx", contains: "await supabase.auth.signOut();", why: "fence commit profile: moves to features/profile/dao/" },
  { file: "app/(parent)/profile/contact.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit contact: moves to features/contact/dao/" },
  { file: "app/(parent)/profile/contact.tsx", contains: "supabase .from(\"parents\")", why: "fence commit contact: moves to features/contact/dao/ — ⚠ ONE entry, 2 sites (:61, :101 — the snippet is contained in each); all leave in the same commit" },
  { file: "app/(parent)/profile/contact.tsx", contains: "supabase .from(\"profiles\")", why: "fence commit contact: moves to features/contact/dao/ — ⚠ ONE entry, 2 sites (:66, :108 — the snippet is contained in each); all leave in the same commit" },
  { file: "app/(parent)/home/join-tenant.tsx", contains: "import { supabase } from \"@/lib/supabase\";", why: "fence commit join-tenant: moves to features/join-tenant/dao/" },
  { file: "app/(parent)/home/join-tenant.tsx", contains: "const { data, error } = await supabase.rpc(\"join_tenant_by_code\", {", why: "fence commit join-tenant: moves to features/join-tenant/dao/" },
];

/**
 * Check 4 — route-file imports outside its own tiers. APP L-F/G/H L0
 * (2026-09-23) pinned 76 — `@/lib/*`, `@/store/useAppStore`, and three
 * third-party packages (`qrcode`, `expo-image-picker`, `expo-linking`), which
 * move into domain/ (plan R2: the QR build keeps its `try`).
 *
 * SCHEDULE Stage 0b
 * pinned 12: eleven `@/lib/*` modules and `@/store/useAppStore`; all gone at
 * Stage 5.
 *
 * ATTENDANCE Stage 0b
 * pinned 14: thirteen `@/lib/*` modules and `@/store/useAppStore`; all gone at
 * Stage 6.
 *
 * Roster Stage 0b pinned
 * 9: eight `@/lib/*` modules and `@/store/useAppStore`. Each leaves as its
 * symbols move into domain/ or ui/; all nine are gone at Stage 5.
 */
const ALLOWED_PAGE_IMPORTS: Allowed[] = [
  { file: "app/(parent)/home/index.tsx", contains: "@/store/useAppStore", why: "L-F commit parent-home: leaves as its symbols move into features/parent-home/" },
  { file: "app/(parent)/home/index.tsx", contains: "@/lib/supabase", why: "L-F commit parent-home: leaves as its symbols move into features/parent-home/" },
  { file: "app/(parent)/home/index.tsx", contains: "@/lib/packageCoverage", why: "L-F commit parent-home: leaves as its symbols move into features/parent-home/" },
  { file: "app/(parent)/home/index.tsx", contains: "@/lib/claimCandidates", why: "L-F commit parent-home: leaves as its symbols move into features/parent-home/" },
  { file: "app/(parent)/home/index.tsx", contains: "@/lib/lessonDates", why: "L-F commit parent-home: leaves as its symbols move into features/parent-home/" },
  { file: "app/(parent)/home/add-child.tsx", contains: "@/store/useAppStore", why: "L-F commit add-child: leaves as its symbols move into features/add-child/" },
  { file: "app/(parent)/home/add-child.tsx", contains: "@/lib/supabase", why: "L-F commit add-child: leaves as its symbols move into features/add-child/" },
  { file: "app/(parent)/home/add-child.tsx", contains: "@/lib/claimCandidates", why: "L-F commit add-child: leaves as its symbols move into features/add-child/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "@/lib/supabase", why: "L-F commit child-profile: leaves as its symbols move into features/child-profile/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "@/lib/lessonDates", why: "L-F commit child-profile: leaves as its symbols move into features/child-profile/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "@/lib/packageCoverage", why: "L-F commit child-profile: leaves as its symbols move into features/child-profile/" },
  { file: "app/(parent)/home/child/[id].tsx", contains: "@/lib/skillProgress", why: "L-F commit child-profile: leaves as its symbols move into features/child-profile/" },
  { file: "app/(parent)/home/edit-child.tsx", contains: "@/store/useAppStore", why: "L-F commit edit-child: leaves as its symbols move into features/edit-child/" },
  { file: "app/(parent)/home/edit-child.tsx", contains: "@/lib/supabase", why: "L-F commit edit-child: leaves as its symbols move into features/edit-child/" },
  { file: "app/(parent)/billing/index.tsx", contains: "@/lib/lessonDates", why: "L-G commit billing: leaves as its symbols move into features/billing/" },
  { file: "app/(parent)/billing/index.tsx", contains: "@/store/useAppStore", why: "L-G commit billing: leaves as its symbols move into features/billing/" },
  { file: "app/(parent)/billing/index.tsx", contains: "@/lib/supabase", why: "L-G commit billing: leaves as its symbols move into features/billing/" },
  { file: "app/(parent)/billing/index.tsx", contains: "@/lib/invoiceLabel", why: "L-G commit billing: leaves as its symbols move into features/billing/" },
  { file: "app/(parent)/billing/index.tsx", contains: "@/lib/confirm", why: "L-G commit billing: leaves as its symbols move into features/billing/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "@/lib/lessonDates", why: "L-G commit invoice-detail: leaves as its symbols move into features/invoice-detail/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "@/lib/supabase", why: "L-G commit invoice-detail: leaves as its symbols move into features/invoice-detail/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "@/lib/confirm", why: "L-G commit invoice-detail: leaves as its symbols move into features/invoice-detail/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "@/lib/invoiceFunding", why: "L-G commit invoice-detail: leaves as its symbols move into features/invoice-detail/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "@/lib/invoiceLabel", why: "L-G commit invoice-detail: leaves as its symbols move into features/invoice-detail/" },
  { file: "app/(parent)/billing/invoice/[id].tsx", contains: "@/store/useAppStore", why: "L-G commit invoice-detail: leaves as its symbols move into features/invoice-detail/" },
  { file: "app/(parent)/billing/paynow.tsx", contains: "qrcode", why: "L-G commit paynow: leaves as its symbols move into features/paynow/" },
  { file: "app/(parent)/billing/paynow.tsx", contains: "@/lib/supabase", why: "L-G commit paynow: leaves as its symbols move into features/paynow/" },
  { file: "app/(parent)/billing/paynow.tsx", contains: "@/lib/paynow", why: "L-G commit paynow: leaves as its symbols move into features/paynow/" },
  { file: "app/invoice/[token].tsx", contains: "qrcode", why: "L-G commit public-invoice: leaves as its symbols move into features/public-invoice/" },
  { file: "app/invoice/[token].tsx", contains: "@/lib/confirm", why: "L-G commit public-invoice: leaves as its symbols move into features/public-invoice/" },
  { file: "app/invoice/[token].tsx", contains: "@/lib/paynow", why: "L-G commit public-invoice: leaves as its symbols move into features/public-invoice/" },
  { file: "app/package/[token].tsx", contains: "qrcode", why: "L-G commit public-package: leaves as its symbols move into features/public-package/" },
  { file: "app/package/[token].tsx", contains: "@/lib/confirm", why: "L-G commit public-package: leaves as its symbols move into features/public-package/" },
  { file: "app/package/[token].tsx", contains: "@/lib/paynow", why: "L-G commit public-package: leaves as its symbols move into features/public-package/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "@/store/useAppStore", why: "L-H commit parent-attendance: leaves as its symbols move into features/parent-attendance/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "@/lib/supabase", why: "L-H commit parent-attendance: leaves as its symbols move into features/parent-attendance/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "@/lib/lessonDates", why: "L-H commit parent-attendance: leaves as its symbols move into features/parent-attendance/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "@/lib/upcomingLessons", why: "L-H commit parent-attendance: leaves as its symbols move into features/parent-attendance/" },
  { file: "app/(parent)/attendance/index.tsx", contains: "@/lib/scheduleWeek", why: "L-H commit parent-attendance: leaves as its symbols move into features/parent-attendance/" },
  { file: "app/(coach)/settings/index.tsx", contains: "expo-image-picker", why: "L-H commit coach-settings: leaves as its symbols move into features/coach-settings/" },
  { file: "app/(coach)/settings/index.tsx", contains: "@/store/useAppStore", why: "L-H commit coach-settings: leaves as its symbols move into features/coach-settings/" },
  { file: "app/(coach)/settings/index.tsx", contains: "@/lib/supabase", why: "L-H commit coach-settings: leaves as its symbols move into features/coach-settings/" },
  { file: "app/(coach)/settings/index.tsx", contains: "@/lib/confirm", why: "L-H commit coach-settings: leaves as its symbols move into features/coach-settings/" },
  { file: "app/(coach)/classes/index.tsx", contains: "@/store/useAppStore", why: "L-H commit coach-classes: leaves as its symbols move into features/coach-classes/" },
  { file: "app/(coach)/classes/index.tsx", contains: "@/lib/supabase", why: "L-H commit coach-classes: leaves as its symbols move into features/coach-classes/" },
  { file: "app/(coach)/classes/index.tsx", contains: "@/lib/lessonDates", why: "L-H commit coach-classes: leaves as its symbols move into features/coach-classes/" },
  { file: "app/(coach)/classes/index.tsx", contains: "@/lib/weekOrder", why: "L-H commit coach-classes: leaves as its symbols move into features/coach-classes/" },
  { file: "app/(coach)/classes/index.tsx", contains: "@/lib/locationFilter", why: "L-H commit coach-classes: leaves as its symbols move into features/coach-classes/" },
  { file: "app/(auth)/register.tsx", contains: "@/store/useAppStore", why: "L-H commit register: leaves as its symbols move into features/register/" },
  { file: "app/(auth)/register.tsx", contains: "@/lib/supabase", why: "L-H commit register: leaves as its symbols move into features/register/" },
  { file: "app/(auth)/register.tsx", contains: "@/lib/authErrors", why: "L-H commit register: leaves as its symbols move into features/register/" },
  { file: "app/(auth)/login.tsx", contains: "@/store/useAppStore", why: "fence commit login: leaves as its symbols move into features/login/" },
  { file: "app/(auth)/login.tsx", contains: "@/lib/supabase", why: "fence commit login: leaves as its symbols move into features/login/" },
  { file: "app/(auth)/login.tsx", contains: "@/lib/landing", why: "fence commit login: leaves as its symbols move into features/login/" },
  { file: "app/(auth)/login.tsx", contains: "@/lib/authErrors", why: "fence commit login: leaves as its symbols move into features/login/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "@/lib/supabase", why: "fence commit accept-invite: leaves as its symbols move into features/accept-invite/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "@/lib/authErrors", why: "fence commit accept-invite: leaves as its symbols move into features/accept-invite/" },
  { file: "app/(auth)/accept-invite.tsx", contains: "@/store/useAppStore", why: "fence commit accept-invite: leaves as its symbols move into features/accept-invite/" },
  { file: "app/(auth)/reset-password.tsx", contains: "@/lib/supabase", why: "fence commit reset-password: leaves as its symbols move into features/reset-password/" },
  { file: "app/(auth)/reset-password.tsx", contains: "@/lib/authErrors", why: "fence commit reset-password: leaves as its symbols move into features/reset-password/" },
  { file: "app/(auth)/reset-password.tsx", contains: "@/store/useAppStore", why: "fence commit reset-password: leaves as its symbols move into features/reset-password/" },
  { file: "app/(auth)/forgot-password.tsx", contains: "expo-linking", why: "fence commit forgot-password: leaves as its symbols move into features/forgot-password/" },
  { file: "app/(auth)/forgot-password.tsx", contains: "@/lib/supabase", why: "fence commit forgot-password: leaves as its symbols move into features/forgot-password/" },
  { file: "app/(auth)/forgot-password.tsx", contains: "@/lib/authErrors", why: "fence commit forgot-password: leaves as its symbols move into features/forgot-password/" },
  { file: "app/(auth)/forgot-password.tsx", contains: "@/store/useAppStore", why: "fence commit forgot-password: leaves as its symbols move into features/forgot-password/" },
  { file: "app/(coach)/classes/[id]/grade.tsx", contains: "@/lib/supabase", why: "fence commit grade: leaves as its symbols move into features/grade/" },
  { file: "app/(coach)/classes/[id]/grade.tsx", contains: "@/lib/skillProgress", why: "fence commit grade: leaves as its symbols move into features/grade/" },
  { file: "app/(coach)/pay/index.tsx", contains: "@/lib/supabase", why: "fence commit coach-pay: leaves as its symbols move into features/coach-pay/" },
  { file: "app/(coach)/pay/index.tsx", contains: "@/lib/payoutBreakdown", why: "fence commit coach-pay: leaves as its symbols move into features/coach-pay/" },
  { file: "app/(parent)/profile/index.tsx", contains: "@/store/useAppStore", why: "fence commit profile: leaves as its symbols move into features/profile/" },
  { file: "app/(parent)/profile/index.tsx", contains: "@/lib/supabase", why: "fence commit profile: leaves as its symbols move into features/profile/" },
  { file: "app/(parent)/profile/index.tsx", contains: "@/lib/confirm", why: "fence commit profile: leaves as its symbols move into features/profile/" },
  { file: "app/(parent)/profile/contact.tsx", contains: "@/store/useAppStore", why: "fence commit contact: leaves as its symbols move into features/contact/" },
  { file: "app/(parent)/profile/contact.tsx", contains: "@/lib/supabase", why: "fence commit contact: leaves as its symbols move into features/contact/" },
  { file: "app/(parent)/home/join-tenant.tsx", contains: "@/store/useAppStore", why: "fence commit join-tenant: leaves as its symbols move into features/join-tenant/" },
  { file: "app/(parent)/home/join-tenant.tsx", contains: "@/lib/supabase", why: "fence commit join-tenant: leaves as its symbols move into features/join-tenant/" },
];

/** Blank comments in place, preserving newlines, so line numbers stay true. */
function stripComments(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
    } else i++;
  }
  return out.join("");
}

type Src = { file: string; code: string; lines: string[] };

const rel = (full: string) => full.slice(APP.length + 1).split(sep).join("/");

function read(full: string): Src {
  const code = stripComments(readFileSync(full, "utf8"));
  return { file: rel(full), code, lines: code.split("\n") };
}

function sources(): Src[] {
  const found: Src[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(read(full));
    }
  };
  for (const dir of SCOPE_DIRS) walk(join(APP, dir));
  // A missing route file is NOT read (it would throw ENOENT and read as a broken
  // test); the "scans every scoped page" test below goes red on it instead.
  for (const { page } of PAGES) if (existsSync(join(APP, page))) found.push(read(join(APP, page)));
  return found;
}

const inTier = (file: string, tier: "ui" | "domain" | "dao") =>
  file.includes(`/${tier}/`);

type Site = { file: string; line: number; text: string };

/** Every static import specifier, with its line. */
function imports(s: Src): Site[] {
  const out: Site[] = [];
  const re = /(?:\bfrom\s*|^\s*import\s*)["']([^"'\n<>]+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s.code)) !== null) {
    out.push({
      file: s.file,
      line: s.code.slice(0, m.index).split("\n").length,
      text: m[1],
    });
  }
  return out;
}

/** lib/ modules that import the supabase client themselves (one level). */
function clientHelpers(): string[] {
  const lib = join(APP, "lib");
  return readdirSync(lib)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "supabase.ts")
    .filter((f) =>
      /from\s*["'](\.\/supabase|@\/lib\/supabase)["']/.test(
        stripComments(readFileSync(join(lib, f), "utf8"))
      )
    )
    .map((f) => f.replace(/\.tsx?$/, ""));
}

const HELPERS = clientHelpers();
const helperImport = new RegExp(
  `from\\s*["']@\\/lib\\/(${HELPERS.join("|") || "(?!)"})["']`
);

/**
 * Lines that reach the network: a supabase client use, a `fetch(` call, or an
 * import of a client-holding lib/ helper. A builder chain that opens with a
 * bare `supabase` at end-of-line is joined with the next line, so it can be
 * pinned by the table it reads (`supabase .from("students")`).
 */
function dataAccess(s: Src): Site[] {
  const out: Site[] = [];
  s.lines.forEach((l, i) => {
    if (/\bsupabase\b/.test(l) || /\bfetch\s*\(/.test(l) || helperImport.test(l)) {
      const joined = /\bsupabase\s*$/.test(l) ? `${l} ${s.lines[i + 1] ?? ""}` : l;
      out.push({ file: s.file, line: i + 1, text: joined.replace(/\s+/g, " ") });
    }
  });
  return out;
}

const allowed = (site: Site, list: Allowed[]) =>
  list.some((a) => a.file === site.file && site.text.includes(a.contains));

function assertNone(offenders: string[], guidance: string): void {
  if (offenders.length > 0) {
    throw new Error(`${guidance}\n\n  ${offenders.join("\n  ")}\n`);
  }
  expect(offenders).toEqual([]);
}

const label = (s: Site) => `${s.file}:${s.line}  ${s.text.trim()}`;

describe("app tier boundaries (route -> ui -> domain -> dao)", () => {
  const srcs = sources();

  it("scans every scoped route file at all (not vacuously green)", () => {
    for (const { page } of PAGES) expect(srcs.map((s) => s.file)).toContain(page);
    // A scoped dir that does not exist makes checks 1-3 vacuous for it (the
    // walk skips a missing dir). Added at roster Stage 1, when features/roster
    // first existed.
    for (const dir of SCOPE_DIRS) expect(existsSync(join(APP, dir))).toBe(true);
    // `null` means "no tiers"; the STRING "null" would quietly allow a
    // features/null folder through check 4's regex.
    for (const { feature } of PAGES) expect(feature).not.toBe("null");
  });

  it("scans every features/ folder (none is orphaned from PAGES)", () => {
    // SCOPE_DIRS is derived from PAGES, so a folder no route names is walked by
    // nothing — checks 1-3 would be vacuous for it (§7.233's shape).
    const onDisk = readdirSync(join(APP, "features")).filter((d) =>
      statSync(join(APP, "features", d)).isDirectory()
    );
    expect(onDisk.filter((d) => !FEATURES.includes(d))).toEqual([]);
  });

  it("derives the client-holding lib/ helpers (check 3 is not blind to them)", () => {
    // markableFloor is the one the roster imports; if this list is empty the
    // derivation broke and check 3 silently lost its third leg.
    expect(HELPERS).toContain("markableFloor");
  });

  it("1. ui/ never imports dao/", () => {
    const offenders = srcs
      .filter((s) => inTier(s.file, "ui"))
      .flatMap(imports)
      .filter((i) => /(^|\/)dao(\/|$)/.test(i.text))
      .map(label);
    assertNone(offenders, "ui/ talks to domain/, never to dao/ directly.");
  });

  it("2. dao/ never imports React, react-native, expo-router, ui/, or @/components", () => {
    const offenders = srcs
      .filter((s) => inTier(s.file, "dao"))
      .flatMap(imports)
      .filter((i) =>
        /^react(-dom|-native)?(\/|$)|^expo-router(\/|$)|(^|\/)ui(\/|$)|^@\/components/.test(i.text)
      )
      .map(label);
    assertNone(offenders, "dao/ is transport only: no React, no presentation, no navigation.");
  });

  it("3. only dao/ reaches the network (client, fetch(, or a client-holding lib/ helper)", () => {
    const offenders = srcs
      .filter((s) => !inTier(s.file, "dao"))
      .flatMap(dataAccess)
      .filter((x) => !allowed(x, ALLOWED_DATA_ACCESS))
      .map(label);
    assertNone(
      offenders,
      "Data access belongs in features/<screen>/dao/. Do NOT add to " +
        "ALLOWED_DATA_ACCESS: it only shrinks."
    );
  });

  it("4. a route file imports its tiers, React, RN, expo-router, icons and @/components — never @/lib or @/store", () => {
    const offenders = PAGES.flatMap(({ page: p, feature }) => {
      const page = srcs.find((s) => s.file === p);
      if (!page) return [`${p}  (route file not found — see the scan test)`];
      const base = `^(react$|react-native$|expo-router$|@expo\\/vector-icons$|@\\/components\\/`;
      // A tier-less route (feature: null) gets NO @/features branch at all —
      // never an interpolated "null".
      const ok = new RegExp(
        feature === null
          ? `${base})`
          : `${base}|@\\/features\\/${feature}\\/(ui|domain)\\/|@\\/features\\/${feature}\\/(constants|types)$)`
      );
      return imports(page)
        .filter((i) => !ok.test(i.text))
        .filter((i) => !allowed(i, ALLOWED_PAGE_IMPORTS))
        .map(label);
    });
    assertNone(
      offenders,
      "A route file is composition. Logic -> domain/, data -> dao/. Do NOT add to " +
        "ALLOWED_PAGE_IMPORTS: it only shrinks."
    );
  });

  it("has no unused allowlist entries (the ledger only shrinks)", () => {
    const stale: string[] = [];
    const ledgers: [string, Allowed[], (s: Src) => Site[]][] = [
      ["ALLOWED_DATA_ACCESS", ALLOWED_DATA_ACCESS, dataAccess],
      ["ALLOWED_PAGE_IMPORTS", ALLOWED_PAGE_IMPORTS, imports],
    ];
    for (const [name, list, pick] of ledgers) {
      for (const a of list) {
        const s = srcs.find((x) => x.file === a.file);
        const hit = s !== undefined && pick(s).some((site) => allowed(site, [a]));
        if (!hit) stale.push(`${name}: ${a.file} lacks ${JSON.stringify(a.contains)}`);
      }
    }
    assertNone(stale, "The code moved. Delete the entry; that is the point.");
  });
});
