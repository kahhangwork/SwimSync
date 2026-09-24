import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { firstLoadError } from "./lessonLoadErrors";

const ok = { error: null };
const bad = (message: string) => ({ error: { message } });

describe("firstLoadError", () => {
  it("is null when every read succeeded", () => {
    expect(firstLoadError([ok, ok, ok])).toBeNull();
    expect(firstLoadError([])).toBeNull();
  });

  it("names the FIRST failure, in the order given", () => {
    expect(firstLoadError([ok, bad("classes down"), bad("students down")])).toBe("classes down");
  });

  // The bug: a failed attendance read rendered every row "Not marked", and a
  // re-mark + save then overwrote the real statuses.
  it("fails the page on an attendance read error — it is never an empty result", () => {
    expect(firstLoadError([bad("permission denied for table attendance"), ok, ok])).toBe(
      "permission denied for table attendance"
    );
  });
});

// The rule only holds if the hook hands EVERY read to it. These pin the call
// sites: a read added to the Promise.all but left out of the check would
// quietly re-open the hole.
describe("useLessonDetail checks every read", () => {
  const src = readFileSync(join(__dirname, "useLessonDetail.ts"), "utf8");

  it("checks all eleven lesson reads, the three it used to skip included", () => {
    const [, list] = src.match(/firstLoadError\(\[([\s\S]*?)\]\)/) ?? [];
    const checked = (list ?? "").split(",").map((s) => s.trim()).filter(Boolean).sort();
    const [, destructured] = src.match(/const \[([^\]]*)\] =\s*await loadLessonReads/) ?? [];
    const loaded = (destructured ?? "").split(",").map((s) => s.trim()).filter(Boolean).sort();
    expect(loaded).toHaveLength(11);
    expect(checked).toEqual(loaded);
  });

  it("checks all three session-scoped reads", () => {
    expect(src).toMatch(/firstLoadError\(\[attRes, subRes, absRes\]\)/);
  });

  it("refuses a signed-out load rather than rendering a Save that does nothing", () => {
    expect(src).toMatch(/if \(!sess\.session\) \{\s*setLoadError\(SIGNED_OUT_MESSAGE\)/);
  });
});
