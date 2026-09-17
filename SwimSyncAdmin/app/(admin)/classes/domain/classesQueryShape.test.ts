// ⚠ RISK 3 (CLASSES_REFACTOR_PLAN.md §5a) — a SOURCE pin, not a behaviour test.
//
// Two shapes on this page are load-bearing by their ABSENCE, and no behaviour
// test can observe what a query did NOT do:
//
//   1. loadClasses() must NOT filter `is_active`. A retired class can block a
//      billing month, and this page is the ONLY screen that can show it to be
//      restored (§7.28 / the comment on repo.loadClasses). A one-line
//      `.eq("is_active", true)` "tidy" typechecks, passes every other test, and
//      strands the month with no screen able to clear it — no override exists.
//   2. The roster is FETCHED SEPARATELY (§7.52): student_class_enrolments and
//      trial_bookings are each their OWN `.from(`, never embedded on the class
//      query — one failed embed there blanks every class instead of one drawer.
//   3. loadLocations() must NOT filter `archived_at`: the form picker needs an
//      archived location to represent a reactivated class's current value
//      (RISK 6 on the `locations` state), and the name lookup covers retired
//      classes sitting on an archived location.
//
// This reads dao/classes.repo.ts as TEXT (the tierBoundaries/sgDisplay idiom —
// no ESLint in this repo). Proven RED once at Stage 2/3 by adding
// `.eq("is_active", true)` to loadClasses (check 1 went red), then reverted.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "dao", "classes.repo.ts"), "utf8");

// The exact select the class list has always used. If a column is added or
// removed here the test must be updated deliberately — that is the point.
const CLASSES_SELECT =
  "id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id, capacity, colour, is_active, deactivated_at, coaches(profiles(full_name)), locations(name), class_categories(default_capacity), student_class_enrolments(id, is_active)";

/** The text of one `.from("<table>")` builder, from that call to the next
 *  `.from(` / `.rpc(` / end of file — enough to see its filters. */
function builderFor(table: string): string {
  const start = SRC.indexOf(`.from("${table}")`);
  expect(start, `.from("${table}") is present`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\.(from|rpc)\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("classes dao — load-bearing query shapes (RISK 3 / §7.28 / §7.52)", () => {
  it("loadClasses() carries NO is_active filter (a retired class must load)", () => {
    const builder = builderFor("classes");
    const filters = builder.match(/\.(eq|is|neq|filter)\(\s*["']is_active/g) ?? [];
    expect(filters).toEqual([]);
  });

  it("loadClasses() select is byte-identical to the pinned literal", () => {
    expect(SRC.includes(CLASSES_SELECT)).toBe(true);
  });

  it("the select embeds enrolments only for the count, NOT the roster reads", () => {
    // student_class_enrolments(id, is_active) is the count embed; trial_bookings
    // and a students() embed must NOT appear on the classes select (§7.52).
    const builder = builderFor("classes");
    expect(builder).toContain("student_class_enrolments(id, is_active)");
    expect(builder).not.toContain("trial_bookings(");
    expect(builder).not.toContain("students(");
  });

  it("student_class_enrolments and trial_bookings are each their OWN .from (§7.52)", () => {
    expect((SRC.match(/\.from\("student_class_enrolments"\)/g) ?? []).length).toBe(1);
    expect((SRC.match(/\.from\("trial_bookings"\)/g) ?? []).length).toBe(1);
  });

  it("loadLocations() carries NO archived_at filter (RISK 6 — picker needs archived)", () => {
    const builder = builderFor("locations");
    const filters = builder.match(/\.(eq|is|neq|filter)\(\s*["']archived_at/g) ?? [];
    expect(filters).toEqual([]);
  });
});
