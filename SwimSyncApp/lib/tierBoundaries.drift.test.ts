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

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// This file lives in SwimSyncApp/lib, so the app root is one level up.
const APP = join(__dirname, "..");

const SCOPE_DIRS = [
  // Coach roster (full track), 2026-09-21.
  "features/roster",
  // Coach attendance marking (full track), 2026-09-22.
  "features/mark-attendance",
  // Coach Schedule, the landing tab (full track), 2026-09-22.
  "features/schedule",
];

// The route files. Check 4 runs against each; check 3 scans them too.
const PAGES = [
  "app/(coach)/classes/[id]/roster.tsx",
  "app/(coach)/classes/[id]/attendance.tsx",
  "app/(coach)/schedule/index.tsx",
];

type Allowed = { file: string; contains: string; why: string };

// (F_ROSTER was deleted with its last ledger entry, roster Stage 5, 2026-09-21.)
// (F_ATT was deleted with its last ledger entry, attendance Stage 6, 2026-09-22.)
const F_SCHED = "app/(coach)/schedule/index.tsx";

/**
 * Check 3 — network reaches outside `dao/`. SCHEDULE Stage 0b pinned 12: the
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
  // ── Coach Schedule (docs/refactor/COACH_SCHEDULE_REFACTOR_PLAN.md) — ALL 12 leave at Stage 3 ──
  { file: F_SCHED, contains: `import { supabase } from "@/lib/supabase"`, why: "the client; Stage 3 (dao/)" },
  { file: F_SCHED, contains: `from "@/lib/markableFloor"`, why: "client-holding helper; Stage 3 binds it in dao/schedule.rpc.ts" },
  { file: F_SCHED, contains: `from "@/lib/sessionMainCoach"`, why: "client-holding helper; Stage 3 binds it in dao/schedule.rpc.ts" },
  { file: F_SCHED, contains: `supabase.from("coaches")`, why: "coach lookup; Stage 3 (dao/schedule.repo.ts)" },
  // ⚠ KEEP THE SPACE: a bare `.from("classes")` also matches the covered and
  // shadowed reads below, so one pin would silently cover three sites.
  { file: F_SCHED, contains: `supabase .from("classes")`, why: "owned classes; Stage 3" },
  { file: F_SCHED, contains: `supabase .from("session_coaches")`, why: "roster rows; Stage 3" },
  { file: F_SCHED, contains: `.in("id", coveredClassIds)`, why: "covered classes; Stage 3" },
  { file: F_SCHED, contains: `supabase .from("class_shadow_coaches")`, why: "shadow assignments; Stage 3" },
  { file: F_SCHED, contains: `.in("id", shadowClassIds)`, why: "shadowed classes; Stage 3" },
  { file: F_SCHED, contains: `supabase .from("lesson_sessions")`, why: "window sessions; Stage 3" },
  { file: F_SCHED, contains: `supabase .from("trial_bookings")`, why: "trial bookings; Stage 3" },
  { file: F_SCHED, contains: `supabase .from("makeup_bookings")`, why: "make-up bookings; Stage 3" },
];

/**
 * Check 4 — route-file imports outside its own tiers. SCHEDULE Stage 0b
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
  // ── Coach Schedule — each leaves when its last symbol moves; all 12 gone at Stage 5 ──
  { file: F_SCHED, contains: "@/store/useAppStore", why: "session; Stage 3 (useScheduleLoad) / Stage 5 (Greeting)" },
  { file: F_SCHED, contains: "@/lib/supabase", why: "Stage 3" },
  { file: F_SCHED, contains: "@/lib/markableFloor", why: "Stage 3" },
  { file: F_SCHED, contains: "@/lib/sessionMainCoach", why: "Stage 3" },
  { file: F_SCHED, contains: "@/lib/lessonDates", why: "todayInSg/backlogWindowStart -> domain, formatSgDate -> ui; by Stage 5" },
  { file: F_SCHED, contains: "@/lib/timeOfDay", why: "nowMinutesInSg -> useWeek, isNowInRange -> ui; by Stage 5" },
  { file: F_SCHED, contains: "@/lib/attendanceSummary", why: "loop -> domain, chips/labels -> ui; by Stage 5" },
  { file: F_SCHED, contains: "@/lib/scheduleWeek", why: "useWeek / useScheduleSections; by Stage 4" },
  { file: F_SCHED, contains: "@/lib/scheduleBuckets", why: "useScheduleSections; Stage 4" },
  { file: F_SCHED, contains: "@/lib/locationFilter", why: "useScheduleSections; Stage 4" },
  { file: F_SCHED, contains: "@/lib/coachRoster", why: "parse* -> useScheduleLoad, canMark/roleBadge -> ui; by Stage 5" },
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
  for (const page of PAGES) if (existsSync(join(APP, page))) found.push(read(join(APP, page)));
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
    for (const page of PAGES) expect(srcs.map((s) => s.file)).toContain(page);
    // featureOf() pairs PAGES[i] with SCOPE_DIRS[i]; a length mismatch would
    // make check 4 throw instead of fail.
    expect(PAGES.length).toBe(SCOPE_DIRS.length);
    // A scoped dir that does not exist makes checks 1-3 vacuous for it (the
    // walk skips a missing dir). Added at roster Stage 1, when features/roster
    // first existed.
    for (const dir of SCOPE_DIRS) expect(existsSync(join(APP, dir))).toBe(true);
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
    const offenders = PAGES.flatMap((p) => {
      const page = srcs.find((s) => s.file === p);
      if (!page) return [`${p}  (route file not found — see the scan test)`];
      const feature = featureOf(p);
      const ok = new RegExp(
        `^(react$|react-native$|expo-router$|@expo\\/vector-icons$|@\\/components\\/|` +
          `@\\/features\\/${feature}\\/(ui|domain)\\/|@\\/features\\/${feature}\\/(constants|types)$)`
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

/** The features/<name> a route file belongs to — one SCOPE_DIRS entry per PAGES entry, by index. */
function featureOf(page: string): string {
  const dir = SCOPE_DIRS[PAGES.indexOf(page)];
  return dir.replace(/^features\//, "");
}
