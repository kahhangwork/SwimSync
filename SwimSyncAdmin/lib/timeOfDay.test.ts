import { describe, it, expect } from "vitest";
import { nowMinutesInSg } from "./timeOfDay";

describe("nowMinutesInSg", () => {
  it("reads the Singapore clock, not the process one", () => {
    // 2026-08-19T01:30:00Z = 09:30 SGT
    expect(nowMinutesInSg(new Date("2026-08-19T01:30:00Z"))).toBe(9 * 60 + 30);
    // 2026-08-19T16:00:00Z = 00:00 SGT next day — midnight normalises to 0, never 1440
    expect(nowMinutesInSg(new Date("2026-08-19T16:00:00Z"))).toBe(0);
    // 23:59 SGT
    expect(nowMinutesInSg(new Date("2026-08-19T15:59:00Z"))).toBe(23 * 60 + 59);
  });
});
