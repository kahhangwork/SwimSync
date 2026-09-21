// CHARACTERISATION TEST (playbook §0): pins behaviour that already existed on
// history/page.tsx before Admin L-E moved it here, so §7.25's prove-it-red rule
// cannot apply.
//
// The date-bound tests are the load-bearing ones (BATCH_E_PLAN.md RISK 6,
// §7.227). The Change History page is what settles a dispute about who changed
// what and when; a whole-day filter built from a ZONELESS `${date}T00:00:00`
// puts the boundary at the viewer's midnight, so a row logged at 07:00 SGT
// lands in the wrong day for anyone whose browser is not in Singapore. The
// offset must be spelled.

import { describe, expect, it } from "vitest";
import { sgDayEnd, sgDayStart } from "../constants";
import { formatWhen, KIND_LABEL } from "./historyRows";

describe("the audit filter's day bounds", () => {
  it("spells the Singapore offset on the start of the day", () => {
    expect(sgDayStart("2026-09-21")).toBe("2026-09-21T00:00:00+08:00");
  });

  it("spells it on the end of the day, inclusive of 23:59:59", () => {
    expect(sgDayEnd("2026-09-21")).toBe("2026-09-21T23:59:59+08:00");
  });

  it("never emits a zoneless bound", () => {
    // §7.227: the failure mode is a string that LOOKS right and is read in the
    // viewer's zone. Both bounds must carry an explicit offset.
    for (const b of [sgDayStart("2026-01-01"), sgDayEnd("2026-01-01")]) {
      expect(b).toMatch(/\+08:00$/);
    }
  });
});

describe("formatWhen", () => {
  // Asserted by PARTS, not as one string: the short month is "Sept" under
  // Node's ICU and "Sep" in some browsers, and that spelling is not what these
  // tests exist to guard. The DAY and the TIME are.
  it("renders an instant in Singapore time regardless of the browser zone", () => {
    // 2026-09-21T00:30:00Z is 08:30 the same morning in SGT.
    const s = formatWhen("2026-09-21T00:30:00Z");
    expect(s).toMatch(/^21 Sep\w* 2026, 8:30 am$/);
  });

  it("puts a UTC evening on the NEXT Singapore day", () => {
    // 17:00Z is 01:00 the following day in SGT — the whole reason the render
    // pins the zone instead of trusting the browser.
    const s = formatWhen("2026-09-21T17:00:00Z");
    expect(s).toMatch(/^22 Sep\w* 2026, 1:00 am$/);
  });
});

describe("KIND_LABEL", () => {
  it("labels every diff kind, including the unknown one", () => {
    expect(KIND_LABEL).toEqual({
      created: "Created",
      updated: "Changed",
      deleted: "Removed",
      unknown: "—",
    });
  });
});
