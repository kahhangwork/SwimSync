import { describe, it, expect } from "vitest";
// TWIN FILE: SwimSyncApp/lib/uiPrimitives.drift.test.ts is identical except that it
// uses jest globals and expects that app's maps. Keep in sync.
//
// The DESIGN.md primitives in components/ui/ hold their classes in variant maps
// (`const X: Record<Variant, string> = { … }`). Tailwind keeps only a class it can
// read WHOLE in the source, so one value built by interpolation — `bg-status-${t}-bg`
// — is purged with no build error and renders unstyled (§7.191). This reads each
// file the way sgDisplay.drift.test.ts does and requires every map value to be a
// plain "double-quoted" literal: no backtick, no `${`, no concatenation.
//
// MUTATION PROOF (§7.25): Tag.tsx's `info:` value → `` `bg-status-${"info"}-bg …` ``
// → RED on "every map value is a whole literal" (run 2026-10-12).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "..", "components", "ui");

/** Every `const NAME: Record<…> = { … };` block in a file → { name, body }. */
function recordMaps(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /const (\w+): Record<[^>]+> = \{([\s\S]*?)\n\};/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push({ name: m[1], body: m[2] });
  return out;
}

/** The map's entries, each `key: <value>,` → [key, raw value text]. */
function entries(body: string): [string, string][] {
  return body
    .split(/,\s*\n/)
    .map((e) => e.trim().replace(/,$/, ""))
    .filter(Boolean)
    .map((e) => {
      const i = e.indexOf(":");
      return [e.slice(0, i).trim(), e.slice(i + 1).trim()];
    });
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
const maps = files.flatMap((f) =>
  recordMaps(readFileSync(join(DIR, f), "utf8")).map((m) => ({ file: f, ...m })),
);

describe("components/ui variant maps are whole literals", () => {
  it("found the maps (guards a silent zero-row pass)", () => {
    // Button: VARIANT, SIZE · Tag: TONE
    expect(maps.map((m) => `${m.file}:${m.name}`).sort()).toEqual(
      ["Button.tsx:SIZE", "Button.tsx:VARIANT", "Tag.tsx:TONE"],
    );
  });

  it.each(maps.map((m) => [`${m.file}:${m.name}`, m.body] as const))(
    "%s — every map value is a whole literal",
    (_name, body) => {
      const es = entries(body);
      expect(es.length).toBeGreaterThanOrEqual(2);
      for (const [key, value] of es) {
        expect([key, value]).toEqual([key, expect.stringMatching(/^"[^"`$]*"$/)]);
      }
    },
  );
});
