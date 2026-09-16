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
];

// One route file per scoped dir. Check 4 runs against each.
const PAGES = SCOPE_DIRS.map((d) => `${d}/page.tsx`);

type Allowed = { file: string; contains: string; why: string };

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
  const re = /(?:\bfrom\s*|^\s*import\s*)["']([^"']+)["']/gm;
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
