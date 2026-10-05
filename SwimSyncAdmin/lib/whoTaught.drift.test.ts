import { describe, it, expect } from "vitest";
// WHO TAUGHT must never be read from `class_rates` directly.
//
// `class_rates` is a MONEY table: its admin SELECT policy needs pricing:view
// (20260927000500). Every surface that names a lesson's teaching coach resolves it
// from the paid_coach_id in force (lib/lessonAttribution.ts) — so when those
// surfaces read `class_rates` directly, an operations-only co-admin (the Front desk
// role, pricing:none) read ZERO rows and every lesson was coachless: the Calendar,
// the lesson page's "Teaching", the prev/next strip ("Unassigned") and the
// Attendance page's Coach column. RLS filters rather than errors, so nothing said so.
// Found 2026-10-05 by verify-front-desk-role; fixed by class_coach_terms()
// (20261005000200), which returns the coach terms without the price.
//
// This scan fails the moment any app source reads `class_rates` with
// `.from("class_rates")` again. A screen that genuinely needs the PRICE (a Pricing
// page) must go through an RPC gated on pricing — add it to ALLOWED with the reason.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ADMIN = join(__dirname, "..");
const ALLOWED: Record<string, string> = {};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("who-taught readers", () => {
  it("no app source reads class_rates directly (use class_coach_terms)", () => {
    const offenders = [join(ADMIN, "app"), join(ADMIN, "lib"), join(ADMIN, "components")]
      .flatMap((d) => {
        try {
          return sources(d);
        } catch {
          return [];
        }
      })
      .filter((f) => /\.from\(\s*["'`]class_rates["'`]\s*\)/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ADMIN, f))
      .filter((f) => !(f in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it("the three known readers call class_coach_terms", () => {
    for (const f of [
      "lib/calendarData.ts",
      "app/(admin)/attendance/dao/attendance.repo.ts",
      "app/(admin)/lessons/[classId]/[date]/dao/lessonDetail.repo.ts",
    ]) {
      expect(readFileSync(join(ADMIN, f), "utf8"), f).toMatch(/\.rpc\(\s*"class_coach_terms"/);
    }
  });
});
