// The Students page is being decomposed into feature-scoped tiers
// (`docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md`, Stage 0b):
//
//   page.tsx  →  ui  →  domain  →  dao  →  (PostgREST | rpc | /api)
//
// SwimSyncAdmin has no ESLint, so the dependency direction is enforced the way
// every other structural rule in this repo is — by a test that reads the source.
// Four checks:
//
//   1. No file in `ui/` imports from `dao/`.
//   2. No file in `dao/` imports React (or anything from `ui/` / `@/components`).
//   3. No file outside `dao/` uses the supabase client or calls `fetch(`.
//   4. `page.tsx` is composition: it imports its own tiers, React, Next, and the
//      shared `@/components/*` primitives — never `@/lib/*`. Logic lives in
//      `domain/`, data access in `dao/`.
//
// Check 3 is the one that pays. It is what stops the inline supabase calls from
// ever coming back — on this page or the seven that follow it.
//
// THE ALLOWLIST IS A DEBT LEDGER, NOT AN EXEMPTION. Checks 3 and 4 are red on
// day one, because `page.tsx` still holds every call this refactor exists to
// move. Each violation is pinned below by file AND a content snippet (never
// file-level — a file-level entry would exempt every future call added to that
// file). As each stage moves a call into `dao/`, its snippet stops matching and
// the "unused entries" test goes red until the entry is deleted. The list shrinks
// to zero at Stage 11. It must never grow.
//
// SCOPE started at `app/(admin)/students/` and was widened to the Admin L-A
// people-pages on 2026-09-13 (coaches, admins, parents, unassigned, claims —
// BATCH_A_PLAN.md). Widen SCOPE_DIRS as each later page/batch is converted, and
// pin its current violations in the ledgers below in the same commit (L0); a
// check red on unconverted pages is a check nobody keeps green.
//
// §7.25: every check was proven RED by breaking the rule on purpose, then
// reverted — re-proven for the L-A scope on 2026-09-13 (ui->dao, dao->react,
// domain fetch(, and an unpinned @/lib import on a page: all four went red).
// Re-proven for the packages scope on 2026-09-15 at Stage 0b: packages/ui/Break
// importing ../dao, packages/dao/break importing React, packages/domain/break
// calling fetch(, and an unpinned @/lib/utils import on packages/page.tsx — all
// four checks went red, then the breakers were removed and 6/6 went green.
// Re-proven for the Admin L-B scope on 2026-09-16 at L0: checks 3 and 4 went
// red on the five pages' real violations before the ledger was pinned, and
// holidays/ui/Break importing ../dao + holidays/dao/break importing React drove
// checks 1 and 2 red; breakers removed, 6/6 green.
// Re-proven for the invoices scope on 2026-09-16 at Stage 0b: checks 3 and 4
// went red on invoices/page.tsx's real violations before the ledger was pinned;
// invoices/ui/Break importing ../dao, invoices/dao/break importing React,
// invoices/domain/break calling fetch(, and an unpinned @/lib/money import on
// the page drove all four checks red — breakers removed, 6/6 green.
// Re-proven for the classes scope on 2026-09-17 at Stage 0b: checks 3 and 4 went
// red on classes/page.tsx's real violations (16 .from()/.rpc() sites + 9 @/lib
// imports + lucide-react) before the ledger was pinned; classes/ui/Break
// importing ../dao, classes/dao/break importing React, classes/domain/break
// calling fetch(, and an unpinned @/lib/csv import on the page drove all four
// checks red — breakers removed, 6/6 green. This scope also tightened the
// import-specifier char class to exclude \n<> (see `imports()`): the page's
// `aria-label="Shadowing from"` (a driver-read label) made the `\bfrom` branch
// capture a JSX blob as a bogus specifier. Strengthening only — no real import
// contains those chars, and every prior scope still matched unchanged (6/6).
// Re-proven for the Admin L-C scope on 2026-09-17 at L0: checks 3 and 4 went
// red on the four money pages' real violations (36 data-access lines, 18 page
// imports) before the ledger was pinned; wages/ui/Break importing ../dao,
// wages/dao/break importing React, wages/domain/break calling fetch(, and an
// unpinned @/lib/utils import on accounting/page.tsx drove all four checks
// red — breakers removed, 6/6 green.
// Re-proven for the platform scope on 2026-09-18 at Stage 0b: checks 3 and 4
// went red on platform/page.tsx's real violations (16 data-access sites + 5
// @/lib imports — the exact counts pre-agreed at plan-review, plan §6 RISK 9)
// before the ledger was pinned; platform/ui/Break importing ../dao,
// platform/dao/break importing React, platform/domain/break calling fetch(, and
// an unpinned @/lib/money import on the page drove all four checks red —
// breakers removed, 6/6 green. The SHRINK test was proven live the same way for
// the first time: corrupting one pinned snippet
// (parent_tenant_balances -> ...balancesXX) turned BOTH the shrink test ("lacks
// ...") and check 3 red, which is the property that makes a stale entry
// impossible to leave behind.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// This file lives in SwimSyncAdmin/lib, so the admin app root is one level up.
const ADMIN = join(__dirname, "..");

const SCOPE_DIRS = [
  "app/(admin)/students",
  // Admin L-A lite batch (docs/refactor/BATCH_A_PLAN.md), widened 2026-09-13.
  // Checks 3 and 4 are red on day one for these five; every violation is pinned
  // in the ledgers below with the stage that removes it, and the ledger only shrinks.
  "app/(admin)/coaches",
  "app/(admin)/admins",
  "app/(admin)/parents",
  "app/(admin)/unassigned",
  "app/(admin)/claims",
  // packages (full track, docs/refactor/PACKAGES_REFACTOR_PLAN.md), widened
  // 2026-09-15 at Stage 0b. Checks 3 and 4 are red on day one; every current
  // violation on packages/page.tsx is pinned below with the stage that removes
  // it (data access -> Stage 2/3 per the §6 grep gate; @/lib imports -> the
  // slice stage that moves the symbol), and the ledger only shrinks from here.
  "app/(admin)/packages",
  // Admin L-B lite batch (docs/refactor/BATCH_B_PLAN.md), widened 2026-09-16.
  // The "calendar" batch: attendance, substitutes, holidays touch the client
  // (checks 3+4 red day one); calendar and lessons reach data through
  // @/lib/calendarData, so only check 4 fires for them. Every current violation
  // is pinned in the ledgers below with the commit that removes it (folded
  // L1-L3 per page, playbook §7.1); the ledger only shrinks from here.
  "app/(admin)/attendance",
  "app/(admin)/substitutes",
  "app/(admin)/holidays",
  "app/(admin)/calendar",
  "app/(admin)/lessons",
  // invoices (full track, docs/refactor/INVOICES_REFACTOR_PLAN.md), widened
  // 2026-09-16 at Stage 0b. Checks 3 and 4 are red on day one for the 1,748-line
  // page; every current violation is pinned in the ledgers below with the stage
  // that removes it (data access -> Stage 2/3; @/lib imports -> the slice stage
  // that moves the symbol). The transitional page->dao import pins are NOT added
  // here (the page imports no dao yet — they would be flagged stale); they are
  // added at Stage 2/3 when the import first appears and removed at Stages 4-9
  // as each hook wraps the call (packages §5, playbook §7.1). Ledger only shrinks.
  "app/(admin)/invoices",
  // classes (full track, docs/refactor/CLASSES_REFACTOR_PLAN.md), widened
  // 2026-09-17 at Stage 0b. Checks 3 and 4 are red on day one for the 1,714-line
  // page; every current violation is pinned in the ledgers below with the stage
  // that removes it (data access -> Stage 2/3 folded; @/lib imports -> the slice
  // stage that moves the symbol — classRoster at Stage 5, locationOptions at
  // Stage 10, both MOVE into domain; the rest STAY in lib and leave the page as
  // their symbols move into hooks/ui). No nested route under classes/, so the
  // whole dir is one unit. Ledger only shrinks.
  "app/(admin)/classes",
  // Admin L-C lite batch (docs/refactor/BATCH_C_PLAN.md), widened 2026-09-17.
  // The "money" batch: all four pages touch the client (checks 3+4 red day
  // one). Every current violation is pinned in the ledgers below with the
  // commit that removes it (folded L1-L3 per page, playbook §7.1); the ledger
  // only shrinks from here.
  "app/(admin)/wages",
  "app/(admin)/credit-notes",
  "app/(admin)/referrals",
  "app/(admin)/accounting",
  // platform (full track, docs/refactor/PLATFORM_REFACTOR_PLAN.md), widened
  // 2026-09-18 at Stage 0b. Checks 3 and 4 are red on day one for the
  // 1,395-line page; every current violation is pinned in the ledgers below
  // with the stage that removes it (data access -> Stage 2/3 folded; @/lib
  // imports -> the slice stage that moves the symbol — moveStudentWarning
  // MOVES into domain/ at Stage 9, the other three STAY in lib and leave the
  // page as their symbols move into dao/hooks/ui). The transitional
  // page->dao pins are NOT added here (the page imports no dao yet — the
  // shrink test would flag them stale); they are added at Stage 2/3 when the
  // import first appears and removed at Stages 8/9/10 (plan §6). Ledger only
  // shrinks.
  "app/(admin)/platform",
];

// One route file per scoped dir. Check 4 runs against each.
const PAGES = SCOPE_DIRS.map((d) => `${d}/page.tsx`);

type Allowed = { file: string; contains: string; why: string };

// Spelled once: the ledgers below name this page 21 times at Stage 0b, and a
// typo in one of them is an entry that silently pins nothing (the shrink test
// would call it stale, which reads as "the code moved" rather than "the path is
// wrong"). Added with the platform scope, 2026-09-18.
const F_PLATFORM = "app/(admin)/platform/page.tsx";

/**
 * Check 3 — data-access lines still outside `dao/`. Students reached ZERO on
 * 2026-09-12. The Admin L-A batch (BATCH_A_PLAN.md) re-opened the ledger on
 * 2026-09-13 with the five people-pages' current calls; every one moves into
 * `<page>/dao/` at commit L1 and its entry is deleted then. Keep it shrinking.
 */
const ALLOWED_DATA_ACCESS: Allowed[] = [
  // ── coaches: DONE — dao/domain/ui extracted, ledger empty ──
  // ── admins: DONE — dao/domain/ui extracted, ledger empty ──
  // ── parents: dao extracted at L1 (parents.repo/rpc.ts), entries removed ──
  // ── unassigned: DONE — dao/domain/ui extracted, ledger empty ──
  // ── claims: DONE — dao/domain/ui extracted, ledger empty ──
  // ── packages (full track, PACKAGES_REFACTOR_PLAN.md §5) — check 3 EMPTY ──
  // Stage 2 moved the 19 .from() calls into dao/packages.repo.ts; Stage 3 moved
  // the 6 RPCs + the package-emails invoke + myTenantId() (the 4 profiles/getUser
  // sites) into dao/packages.rpc.ts. The page now holds ZERO supabase (§6 grep
  // gate met), so every packages data-access entry went stale and was deleted —
  // the ledger shrank to empty for check 3. Nothing more to pin here.
  // ── Admin L-B (BATCH_B_PLAN.md), pinned 2026-09-16. Each page folds L1-L3 in
  //    ONE commit (playbook §7.1); the client + every call move into
  //    <page>/dao/<page>.{repo,rpc}.ts and these entries are deleted then.
  //    calendar and lessons reach data via @/lib/calendarData, so they hold no
  //    supabase line — nothing to pin here for them (check 4 only). ──
  // ── attendance: DONE — dao/domain/ui extracted, ledger empty. All 9 reads +
  //    both RPCs (student_package_coverage, book_makeup) moved into
  //    attendance/dao/attendance.repo.ts. ──
  // ── substitutes: DONE — dao/domain/ui extracted, ledger empty. All reads +
  //    the assign RPC + the delete moved into substitutes/dao/substitutes.repo.ts. ──
  // ── holidays: DONE — dao/domain/ui extracted, ledger empty. myTenantId +
  //    every read/write + both RPCs moved into holidays/dao/holidays.repo.ts. ──
  // ── invoices (full track, INVOICES_REFACTOR_PLAN.md): check 3 EMPTY at Stage
  //    2/3 (folded). The client + all 19 data-access sites moved into
  //    invoices/dao/invoices.{repo,rpc,api}.ts; the page holds ZERO supabase and
  //    ZERO fetch(, so every entry went stale and was deleted. Nothing to pin. ──
  // ── classes (full track, CLASSES_REFACTOR_PLAN.md): check 3 EMPTY at Stage
  //    2/3 (folded), 2026-09-17. The client + all 16 .from()/.rpc() sites moved
  //    into classes/dao/classes.{repo,rpc}.ts; the page holds ZERO supabase, so
  //    every entry went stale and was deleted. Nothing to pin. ──
  // ── Admin L-C (BATCH_C_PLAN.md), pinned 2026-09-17 at L0. Each page folds
  //    L1-L3 in ONE commit (playbook §7.1); the client + every call move into
  //    <page>/dao/ and that page's entries are deleted in the same commit. ──
  // ── accounting: DONE — auth + tenants read in dao/accounting.repo, both RPCs
  //    in dao/accounting.rpc. ──
  // ── referrals: DONE — myTenantId + 4 reads + settings update in
  //    dao/referrals.repo, the 3 RPCs in dao/referrals.rpc. ──
  // ── credit-notes: DONE — auth + viewer profile + the scoped notes query in
  //    dao/creditNotes.repo; coverage + void RPCs and the credit-note-emails
  //    invoke in dao/creditNotes.rpc. ──
  // ── wages: DONE — auth + every read/write in dao/wages.repo (one query each;
  //    the stale-guarded orchestration stays in domain/usePayroll), both RPCs in
  //    dao/wages.rpc. Check 3 for L-C is EMPTY. ──
  // ── platform (full track, PLATFORM_REFACTOR_PLAN.md): check 3 EMPTY at Stage
  //    2/3 (folded), 2026-09-18. The client and all 16 data-access sites moved
  //    into platform/dao/platform.{repo,rpc,api}.ts; the page holds ZERO
  //    supabase and ZERO fetch(, so every entry went stale and was deleted.
  //    Nothing to pin. ──
];

/**
 * Check 4 — imports on `page.tsx` outside its own tiers. Students reached ZERO
 * on 2026-09-12. Admin L-A re-opened it 2026-09-13. `@/lib/supabase` leaves at
 * L1 (dao owns the client); the shared `@/lib/*` helpers become domain/ imports
 * or move into domain/ at L2; `lucide-react` icons move into ui/ at L3.
 * coachDisableImpact (coaches-only) and claimNaming (claims-only) MOVE into
 * their page's domain/; the rest (lessonDates, packageCoverage, studentStatus)
 * are shared and STAY in lib/, reached from domain/ (BATCH_A_PLAN.md).
 */
const ALLOWED_PAGE_IMPORTS: Allowed[] = [
  // ── coaches: DONE — page is composition, ledger empty (coachDisableImpact moved into domain) ──
  // ── admins: DONE — page is composition, ledger empty ──
  // ── parents: DONE — dao/domain/ui extracted, page is composition, ledger empty ──
  // ── unassigned: DONE — page is composition, ledger empty ──
  // ── claims: DONE — page is composition, ledger empty (claimNaming moved into domain) ──
  // ── packages (full track, PACKAGES_REFACTOR_PLAN.md §4 verdicts) ──
  // packageOffers MOVES into packages/domain (sole importer, §4); the other four
  // @/lib/* helpers STAY in lib/ (shared) and are reached from domain/ui after
  // their symbols leave the page. NOTE (§5): the transitional page->dao import
  // pins (./dao/packages.{repo,rpc}) are NOT listed here — they cannot exist at
  // 0b (the page imports no dao yet, so the shrink-test would flag them stale).
  // They are added at Stage 2/3 when the import first appears (playbook §7.1's
  // sanctioned exception) and removed at Stages 4-9 as each hook wraps the call.
  // Transitional (playbook §7.1): until each slice's hook wraps the dao call,
  // the page calls dao/packages.{repo,rpc} directly. @/lib/supabase left at
  // Stage 3 (page holds no client). These two go Stages 4-9 as the hooks land;
  // gone by Stage 11.
  // Both transitional page->dao imports GONE at Stage 9: the last direct
  // repo/rpc caller (generate-offers) became a hook, so the page imports no dao
  // at all. Entries deleted.
  // @/lib/packageOffers MOVED into packages/domain at Stage 5 (sole importer);
  // the page now imports ./domain/packageOffers (pickOfferProduct), allowed by
  // check 4. Entry deleted (ledger shrinks).
  // @/lib/tableSearch left at Stage 4 — matchesAnyField moved into
  // domain/packageRows.ts (heldMatching); the page no longer imports it.
  // ── packages: DONE at Stage 11 — the three tables moved to ui/ (each with its
  //    own useTableSort), todayInSg/formatSgStamp/money/DMY/ROW_LIMIT went with
  //    them, and @/lib/lessonDates left the page. BOTH packages ledgers are now
  //    empty; page.tsx is composition with zero useState. ──
  // @/lib/referralDiscount left the page at Stage 6 — discountLabel moved into
  // ui/ProductModal (still shared, stays in lib, reached from ui). Deleted.
  // @/lib/waMessage left the page at Stage 9 — buildPackageOfferMessage/
  // buildWaLink/toWaNumber moved into useGenerateOffers + ui/GenerateOffersModal
  // (still shared, stays in lib). Deleted.
  // ── Admin L-B (BATCH_B_PLAN.md), pinned 2026-09-16. Folded L1-L3 per page:
  //    @/lib/supabase -> dao; lucide-react -> ui; a SOLE-importer helper MOVES
  //    into <page>/domain; a SHARED helper STAYS in lib, reached from
  //    domain/ui/dao. calendarData does the data read, so it is bound in
  //    <page>/dao. Verdicts grep-confirmed (BATCH_B_PLAN.md move-or-stay). ──
  // ── attendance: DONE — page is composition, ledger empty. Client -> dao;
  //    lucide icons -> ui; makeupFromAttendance MOVED into attendance/domain
  //    (git mv, sole code importer); csv/lessonDates/packageCoverage/
  //    lessonAttribution/tableSearch reached from domain/ui (shared, stay in lib). ──
  // ── substitutes: DONE — page is composition, ledger empty. lessonDates +
  //    sessionRoster reached from domain/useSubstitutes and ui/SubstitutesTable. ──
  // ── holidays: DONE — page is composition, ledger empty. Client -> dao;
  //    lucide icons -> ui; holidaysCsv MOVED into holidays/domain (git mv, sole
  //    code importer). ──
  // ── calendar: DONE — dao/domain/ui extracted, page is composition, ledger
  //    empty. calendarData bound in calendar/dao; calendarLessons/lessonDates/
  //    timeOfDay reached from domain (rangeLabel + filters) and ui/CalendarBody. ──
  // ── lessons (list): DONE — dao/domain/ui extracted, page is composition,
  //    ledger empty. attendanceWindow STAYS (shared: lessonMarking.ts +
  //    markableFloor.ts import it via relative path — the @/lib grep missed
  //    those; corrected from the L0 MOVE verdict). calendarData bound in
  //    lessons/dao; every other @/lib helper reached from domain/ui. ──
  // ── invoices (full track, INVOICES_REFACTOR_PLAN.md): check 4 EMPTY at Stage 9.
  //    paynow + settlementPayload MOVED into invoices/domain (sole importers);
  //    the shared @/lib helpers (csv/lessonDates/sgPhone/waMessage/tableSearch/
  //    classCoverage) are reached from domain/ui/dao; lucide icons -> ui;
  //    ReminderQueue -> ui/ReminderQueue. The page imports only its own tiers,
  //    React and @/components — every entry went stale and was deleted. ──
  // ── classes (full track, CLASSES_REFACTOR_PLAN.md), pinned 2026-09-17 at
  //    Stage 0b. @/lib/supabase leaves at Stage 2/3 (dao owns the client).
  //    classRoster MOVES into classes/domain at Stage 5, locationOptions at
  //    Stage 10 (both sole importers, §3); the rest STAY in lib (shared) and the
  //    page stops importing them as their symbols move into hooks/ui. Every entry
  //    is deleted when its import leaves the page; the ledger only shrinks. ──
  // ── classes (full track): check 4 EMPTY at Stage 10+11 (2026-09-17), bar the
  //    one lucide icon the PageHeader action still uses. Everything else left as
  //    its slice landed: @/lib/tableSort -> classRows (S4); @/lib/classRoster
  //    MOVED into domain + @/lib/packageCoverage -> useRoster (S5); @/lib/
  //    sessionRoster + @/lib/utils -> ui/RosterDrawer (S6); the transitional
  //    ./dao/classes.{repo,rpc} pins removed once every call was behind a hook;
  //    @/lib/locationOptions MOVED into domain + @/lib/classColours ->
  //    ui/ClassFormModal + @/lib/lessonDates (todayInSg) -> useClassForm (S10/11).
  //    The lucide Plus icon moved into ui/NewClassButton (coaches pattern), so
  //    the page imports only its own tiers, React, Next and @/components — check
  //    4 EMPTY. Nothing to pin. ──
  // ── Admin L-C (BATCH_C_PLAN.md), pinned 2026-09-17 at L0. Folded L1-L3 per
  //    page: @/lib/supabase -> dao; lucide-react -> ui; a SOLE-importer helper
  //    MOVES into <page>/domain (git mv); a SHARED helper STAYS in lib, reached
  //    from domain/ui/dao. Verdicts grep-confirmed (BATCH_C_PLAN.md). ──
  // ── accounting: DONE — page is composition, ledger empty. Client -> dao;
  //    accounting MOVED into accounting/domain (git mv, sole code importer). ──
  // ── referrals: DONE — page is composition, ledger empty. referralDiscount
  //    (shared with packages) + lessonDates reached from types/ui. ──
  // ── credit-notes: DONE — page is composition, ledger empty. lucide -> ui;
  //    creditNoteEmailState + creditNoteVoidState MOVED into credit-notes/domain
  //    (git mv, sole code importer); csv/lessonDates/packageCoverage/tableSearch
  //    reached from domain/ui/dao (shared, stay in lib). ──
  // ── wages: DONE — page is composition, ledger empty. lucide -> ui;
  //    payoutItems MOVED into wages/domain (git mv, sole code importer);
  //    lessonDates + lessonAttribution reached from domain/ui (shared). Check 4
  //    for L-C is EMPTY — both ledgers empty again. ──
  // ── platform (full track, PLATFORM_REFACTOR_PLAN.md), pinned 2026-09-18 at
  //    Stage 0b. Exactly 5 imports, each with the stage that removes it (§4
  //    verdicts, grep-confirmed both ways + the *.test.ts path-pin grep).
  //    moveStudentWarning MOVES into platform/domain (sole importer); the other
  //    three STAY in lib/ (shared: lessonDates 52 importers, packageCoverage 18,
  //    tableSearch 6) and simply stop being imported HERE as their symbols move
  //    into dao/domain/ui. The transitional ./dao/platform.{repo,rpc,api} pins
  //    are deliberately absent: the page imports no dao yet, so the shrink test
  //    would flag them stale. They are added at Stage 2/3 and removed at Stages
  //    8 (.api), 9 (.rpc) and 10 (.repo). ──
  { file: F_PLATFORM, contains: "@/lib/lessonDates", why: "formatSgDate/toSgDate move into ui/TenantsTable + ui/StrandedPanel at Stage 5; STAYS in lib (52 importers)" },
  { file: F_PLATFORM, contains: "@/lib/packageCoverage", why: "coverageByStudent + StudentCoverage move into domain/useStudentMove at Stage 9; STAYS in lib (18 importers)" },
  { file: F_PLATFORM, contains: "@/lib/moveStudentWarning", why: "MOVES into platform/domain at Stage 9 (sole importer, git mv with its test)" },
  // TRANSITIONAL (playbook §7.1, packages plan §5): until each slice's hook wraps
  // its dao call, the page calls dao/platform.{repo,rpc,api} directly. These
  // three could NOT be pinned at 0b — the page imported no dao yet, so the
  // shrink test would have called them stale. Their removal stage is the stage
  // whose hook takes the LAST direct caller. There is never a fourth.
  { file: F_PLATFORM, contains: "./dao/platform.api", why: "last direct caller is toggleSuspend; gone at Stage 8" },
  { file: F_PLATFORM, contains: "./dao/platform.rpc", why: "last direct callers are doMove/handleSearch; gone at Stage 9" },
  { file: F_PLATFORM, contains: "./dao/platform.repo", why: "last direct caller is handleFamilySearch; gone at Stage 10" },
];

// ─────────────────────────────────────────────────────────────────────────────

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

function sources(): Src[] {
  const found: Src[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // A subdirectory that holds its OWN page.tsx is a separate route unit,
        // not part of this scope. `lessons/[classId]/[date]` (a full-track
        // giant) lives under `lessons/` (the list page, Admin L-B) but is
        // refactored on its own turn — it is scoped, and its boundaries
        // checked, when ITS widening adds it to SCOPE_DIRS. Don't drag a
        // sibling route into a parent's ledger. Tier folders (ui/domain/dao)
        // have no page.tsx, so they are still walked. (Added 2026-09-16 with
        // Admin L-B — the first scoped dir with a nested route.)
        if (existsSync(join(full, "page.tsx"))) continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        const code = stripComments(readFileSync(full, "utf8"));
        found.push({
          file: full.slice(ADMIN.length + 1).split(sep).join("/"),
          code,
          lines: code.split("\n"),
        });
      }
    }
  };
  for (const dir of SCOPE_DIRS) walk(join(ADMIN, dir));
  return found;
}

const inTier = (file: string, tier: "ui" | "domain" | "dao") =>
  file.includes(`/${tier}/`);

type Site = { file: string; line: number; text: string };

/** Every static import specifier, with its line. */
function imports(s: Src): Site[] {
  const out: Site[] = [];
  // The specifier char class excludes newline and angle brackets: a real ES
  // module specifier never contains any of them, so this cannot miss an import
  // — but it stops the `\bfrom\s*["']` alternative from firing on the English
  // word "from" ending a JSX string (e.g. `aria-label="Shadowing from"` on the
  // classes page, whose driver reads that exact label), where the "specifier"
  // would otherwise capture the JSX blob up to the next quote. Tightened
  // 2026-09-17 (classes Stage 0b); strengthening only — every prior page still
  // matches its real imports unchanged.
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

/**
 * Lines that reach the network: a supabase client use, or a `fetch(` call.
 * A builder chain that opens with a bare `supabase` at end-of-line is joined
 * with the next line, so it can be pinned by the table it reads
 * (`supabase .from("students")`) rather than by a bare token.
 */
function dataAccess(s: Src): Site[] {
  const out: Site[] = [];
  s.lines.forEach((l, i) => {
    if (/\bsupabase\b/.test(l) || /\bfetch\s*\(/.test(l)) {
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

describe("admin tier boundaries (page -> ui -> domain -> dao)", () => {
  const srcs = sources();

  it("scans every scoped page at all (not vacuously green)", () => {
    for (const page of PAGES) expect(srcs.map((s) => s.file)).toContain(page);
  });

  it("1. ui/ never imports dao/", () => {
    const offenders = srcs
      .filter((s) => inTier(s.file, "ui"))
      .flatMap(imports)
      .filter((i) => /(^|\/)dao(\/|$)/.test(i.text))
      .map(label);
    assertNone(offenders, "ui/ talks to domain/, never to dao/ directly.");
  });

  it("2. dao/ never imports React, ui/, or @/components", () => {
    const offenders = srcs
      .filter((s) => inTier(s.file, "dao"))
      .flatMap(imports)
      .filter((i) =>
        /^react(-dom)?(\/|$)|(^|\/)ui(\/|$)|^@\/components/.test(i.text)
      )
      .map(label);
    assertNone(offenders, "dao/ is transport only: no React, no presentation.");
  });

  it("3. only dao/ uses the supabase client or calls fetch(", () => {
    const offenders = srcs
      .filter((s) => !inTier(s.file, "dao"))
      .flatMap(dataAccess)
      .filter((x) => !allowed(x, ALLOWED_DATA_ACCESS))
      .map(label);
    assertNone(
      offenders,
      "Data access belongs in dao/students.{repo,rpc,api}.ts. Do NOT add to " +
        "ALLOWED_DATA_ACCESS: it only shrinks."
    );
  });

  it("4. page.tsx imports its tiers, React, Next and @/components, never @/lib", () => {
    const ok = /^(react$|next\/|@\/components\/|\.\/(ui|domain)\/|\.\/(constants|types)$)/;
    const offenders = PAGES.flatMap((p) => {
      const page = srcs.find((s) => s.file === p)!;
      return imports(page)
        .filter((i) => !ok.test(i.text))
        .filter((i) => !allowed(i, ALLOWED_PAGE_IMPORTS))
        .map(label);
    });
    assertNone(
      offenders,
      "page.tsx is composition. Logic -> domain/, data -> dao/. Do NOT add to " +
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
