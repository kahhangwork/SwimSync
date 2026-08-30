// TWIN FILE: SwimSyncAdmin/lib/sgDisplay.drift.test.ts is identical except that
// it imports the test API from vitest (this one uses jest globals). Keep in sync.
//
// A `timestamptz` is an INSTANT. Rendering it with `toLocaleDateString("en-SG")`
// and no `timeZone` shows the VIEWER's calendar date, so anything stamped between
// 00:00 and 08:00 SGT reads as the previous day west of Singapore. That is §7.7's
// axis on a display surface, and §7.227 is what it cost when it reached a product
// rule rather than a label.
//
// Ten admin sites and five app helpers were fixed in one sweep. This test is why
// an eleventh cannot be added: the failure mode is invisible to everyone who
// writes the code, because every developer and every user is currently in
// Singapore, where the buggy call and the correct one render identically.
//
// THREE RULES, and the second is the one that is easy to get wrong:
//
//   1. A `toLocale*String` call with no `timeZone` is a red.
//   2. A `timeZone: "UTC"` is ALSO a red unless justified. Presence of `timeZone`
//      is not correctness — "UTC" on a timestamptz passes a naive guard while
//      rendering the wrong date eight hours out of every twenty-four. That is the
//      §7.227 bug with a green light over it. UTC is correct ONLY when the Date
//      was itself built as UTC (`Date.UTC(...)`, or a parsed "YYYY-MM-DD"), where
//      it is the only choice that shows the date you passed in.
//   3. `lessonDates.ts`'s two copies must stay byte-identical apart from line 3,
//      the TWIN FILE pointer that names the other file.
//
// The fixed sites do not merely SATISFY this scanner — they contain no
// `toLocale*String` call at all any more, because they route through
// `formatSgStamp()`. The pattern was removed, not appeased.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// This file lives in SwimSyncAdmin/lib, so the repo root is two levels up.
const ROOT = join(__dirname, "..", "..");

const SCAN_DIRS = [
  "SwimSyncAdmin/app",
  "SwimSyncAdmin/components",
  "SwimSyncAdmin/lib",
  "SwimSyncApp/app",
  "SwimSyncApp/components",
  "SwimSyncApp/lib",
];

/**
 * Sites that are allowed to render a date without an Asia/Singapore pin.
 *
 * Pinned by file AND by a content snippet, never file-level: a file-level entry
 * would exempt every future call added to that file, which is exactly how the ten
 * offenders accumulated in the first place. If a snippet stops matching, the entry
 * stops applying and the site goes red — which is the intended behaviour, not a
 * bug in the test.
 */
const ALLOWED: { file: string; contains: string; why: string }[] = [
  // ── A billing month built from its own parts ──────────────────────────────
  // `new Date(y, m - 1, 1)` is LOCAL midnight, rendered in that same local zone,
  // at month+year granularity. A local-midnight Date formatted locally always
  // yields the month it was built from, in every zone. Verified from
  // America/New_York: still "August 2026". No instant is involved.
  {
    file: "SwimSyncAdmin/app/(admin)/dashboard/page.tsx",
    contains: "parseInt(month) - 1",
    why: "billing month from parts, month+year only",
  },
  {
    file: "SwimSyncAdmin/app/(admin)/invoices/page.tsx",
    contains: "parseInt(month) - 1",
    why: "billing month from parts, month+year only",
  },
  {
    file: "SwimSyncApp/app/(parent)/billing/index.tsx",
    contains: "parseInt(month) - 1",
    why: "billing month from parts, month+year only",
  },
  {
    file: "SwimSyncApp/app/(parent)/billing/invoice/[id].tsx",
    contains: "parseInt(month) - 1",
    why: "billing month from parts, month+year only",
  },
  {
    file: "SwimSyncApp/app/(parent)/billing/paynow.tsx",
    contains: "parseInt(month) - 1",
    why: "billing month from parts, month+year only",
  },
  {
    file: "SwimSyncApp/app/invoice/[token].tsx",
    contains: "new Date(y, m - 1, 1)",
    why: "billing month from parts, month name only",
  },
  {
    file: "SwimSyncApp/lib/payoutBreakdown.ts",
    contains: "Number(month) - 1",
    why: "payout period from parts, month+year only",
  },

  // ── Not a date at all ─────────────────────────────────────────────────────
  // PROHIBITION: never add a `timeZone` option to a Number formatter to silence
  // this scanner. It does nothing, and it turns a false positive into a lie that
  // outlives everyone who understood it.
  {
    file: "SwimSyncAdmin/lib/accounting.ts",
    contains: "Math.abs(v).toLocaleString",
    why: "formats a Number (currency); timeZone is meaningless here",
  },

  // ── UTC that is CORRECT, because the Date was built as UTC ────────────────
  // `Date.UTC(y, mo - 1, 1)` formatted with timeZone "UTC" shows the month it was
  // given, in every zone. This is the pairing rule 2 exists to distinguish from a
  // timestamptz rendered as UTC, which is wrong.
  {
    file: "SwimSyncAdmin/lib/accounting.ts",
    contains: "Date.UTC(y, mo - 1, 1)",
    why: "UTC-built Date formatted as UTC — the only correct pairing",
  },
];

// `formatSgDate` parses a "YYYY-MM-DD" to a UTC-midnight epoch and MUST format it
// back as UTC, or the label drifts a day west of Greenwich. It is the one place a
// UTC pin is structural rather than incidental, so it is exempted by file.
const UTC_EXEMPT_FILES = [
  "SwimSyncAdmin/lib/lessonDates.ts",
  "SwimSyncApp/lib/lessonDates.ts",
];

const CALL = /\.toLocale(?:Date|Time)?String\s*\(/g;

/**
 * Blank out comments and string bodies, PRESERVING newlines so reported line
 * numbers stay true. Without this a doc comment that merely mentions
 * `toLocaleDateString()` — `lessonDates.ts` has one — reads as a call site.
 */
function stripNoise(src: string): string {
  // Blank IN PLACE so offsets stay identical to the raw source. An earlier draft
  // dropped line-comment characters instead of blanking them, which shifted every
  // span after the first `//` in a file and reported `history/page.tsx` — a
  // correct site — as an offender.
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
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === "`") {
      // A template literal's TEXT is noise, but its `${...}` substitutions are
      // real code and can hold a real call site — `invoices/page.tsx:1693`
      // renders a date inside a `title={...}` template and was missed when the
      // whole literal was blanked.
      let j = i + 1;
      let seg = j;
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "$" && src[j + 1] === "{") {
          blank(seg, j);
          let depth = 1;
          j += 2;
          while (j < src.length && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          seg = j;
          continue;
        }
        j++;
      }
      blank(seg, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
        found.push(full);
    }
  };
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir));
  return found;
}

/**
 * The start of the block enclosing `at` — the last blank line before it, which in
 * this codebase separates one top-level function from the next. Capped so a file
 * with no blank lines cannot hand back its whole contents.
 */
function blockStart(raw: string, at: number): number {
  const floor = Math.max(0, at - 400);
  const gap = raw.lastIndexOf("\n\n", at);
  return gap === -1 ? floor : Math.max(floor, gap + 2);
}

type Site = { file: string; line: number; span: string; context: string };

/** Every `toLocale*String(...)` call, with its arguments balanced to the closer. */
function callSites(): Site[] {
  const sites: Site[] = [];
  for (const path of sourceFiles()) {
    const raw = readFileSync(path, "utf8");
    const src = stripNoise(raw);
    const rel = path.slice(ROOT.length + 1);
    let m: RegExpExecArray | null;
    CALL.lastIndex = 0;
    while ((m = CALL.exec(src)) !== null) {
      // Balance parens forward. A line-based grep would mis-read every call whose
      // options object opens on the next line — `history/page.tsx` is exactly that
      // shape, and it is the one file that most deserves to stay under this guard.
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      sites.push({
        file: rel,
        line: src.slice(0, m.index).split("\n").length,
        // The ARGUMENTS only — a `timeZone` mentioned elsewhere in the function
        // must never satisfy the guard for this call.
        span: raw.slice(m.index, i),
        // The receiver expression sits BEFORE the `.toLocale…` token, and is
        // sometimes a variable assigned a line or two earlier, so an allowlist
        // snippet is matched against the preceding source — but only back to the
        // enclosing block. A flat character window reached into the NEIGHBOURING
        // function and silently allowlisted two real offenders
        // (`billing/index.tsx` renders a billing month directly above a
        // timestamptz). An allowlist that matches by proximity is not an
        // allowlist.
        context: raw.slice(blockStart(raw, m.index), i),
      });
    }
  }
  return sites;
}

function isAllowed(site: Site): boolean {
  return ALLOWED.some(
    (a) => a.file === site.file && site.context.includes(a.contains)
  );
}

/**
 * Fail with the offending sites AND the guidance for fixing them. Written as a
 * throw rather than vitest's `expect(value, message)` so the two twins differ
 * only in their import line — jest has no message argument.
 */
function assertNone(offenders: string[], guidance: string): void {
  if (offenders.length > 0) {
    throw new Error(`${guidance}\n\n  ${offenders.join("\n  ")}\n`);
  }
  expect(offenders).toEqual([]);
}

const label = (s: Site) => `${s.file}:${s.line}`;

describe("dates are displayed in Singapore, not the viewer's timezone", () => {
  it("finds call sites at all (the scanner is not vacuously green)", () => {
    // A stripNoise or paren-balancing bug would empty this list and turn every
    // assertion below into a no-op that passes forever.
    expect(callSites().length).toBeGreaterThan(5);
  });

  it("has no date rendered without a timeZone", () => {
    const offenders = callSites()
      .filter((s) => !/timeZone/.test(s.span))
      .filter((s) => !isAllowed(s))
      .map(label);

    assertNone(
      offenders,
      "Use formatSgStamp() from lib/lessonDates.ts — it pins Asia/Singapore and " +
        "accepts a timestamptz or a YYYY-MM-DD. If this site formats a Number, or " +
        "a Date built from its own parts, add it to ALLOWED with a snippet and a reason."
    );
  });

  it("has no date pinned to UTC outside the helper that must", () => {
    const offenders = callSites()
      .filter((s) => /timeZone:\s*["']UTC["']/.test(s.span))
      .filter((s) => !UTC_EXEMPT_FILES.includes(s.file))
      .filter((s) => !isAllowed(s))
      .map(label);

    assertNone(
      offenders,
      'timeZone: "UTC" on a timestamptz renders the wrong date eight hours a day ' +
        "while satisfying a naive guard. UTC is correct only for a Date built as " +
        "UTC (Date.UTC(...) or a parsed YYYY-MM-DD)."
    );
  });

  it("keeps the two lessonDates.ts copies byte-identical", () => {
    // The whole date system stands on this file, and it is the only shared copy
    // with no identity test — it had just the header comment "Keep in sync", which
    // studentStatus.drift.test.ts calls out as the kind of protection that "does
    // not survive the person who has not read it". Line 3 is the TWIN FILE pointer
    // and names the OTHER file, so it is the one legitimate difference.
    const drop3 = (p: string) =>
      readFileSync(join(ROOT, p), "utf8")
        .split("\n")
        .filter((_, i) => i !== 2)
        .join("\n");

    expect(drop3("SwimSyncApp/lib/lessonDates.ts")).toBe(
      drop3("SwimSyncAdmin/lib/lessonDates.ts")
    );
  });
});
