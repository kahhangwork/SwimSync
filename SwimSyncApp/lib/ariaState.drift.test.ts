// RN-web (this app's web build — the deployed app) ignores `accessibilityState`:
// only `aria-*` props reach the DOM. So a control that says
// `accessibilityState={{ selected: … }}` and nothing else tells a screen reader
// nothing about which option is chosen. Found 2026-10-16 on the gender picker
// (BACKLOG *UI restyle leftovers*), then on 11 more controls.
//
// The rule this pins: every JSX element whose accessibilityState carries `selected`
// also carries `aria-pressed` (a button) or `aria-checked` (a radio). Read the file
// the way uiPrimitives.drift.test.ts does — source text, no render.
//
// MUTATION PROOF (§7.25): deleting `aria-pressed={active}` from
// features/billing/ui/Tabs.tsx → RED, naming that file (run 2026-10-16).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SCAN = ["app", "features", "components"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

/** Each opening JSX tag (`<Name … >`) whose props mention accessibilityState with `selected`. */
function selectedTags(src: string): string[] {
  const tags = src.match(/<[A-Z][\w.]*\b[^<>]*?(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^<>]*?)*>/g) ?? [];
  return tags.filter((t) => /accessibilityState=\{\{[^}]*\bselected\b/.test(t));
}

describe("a selected state reaches the DOM", () => {
  const offenders = SCAN.flatMap((d) => tsxFiles(join(ROOT, d))).flatMap((f) =>
    selectedTags(readFileSync(f, "utf8"))
      .filter((t) => !/\baria-(pressed|checked|selected)=/.test(t))
      .map(() => relative(ROOT, f)),
  );

  it("finds the controls it is guarding (the scan is not vacuous)", () => {
    const all = SCAN.flatMap((d) => tsxFiles(join(ROOT, d))).flatMap((f) =>
      selectedTags(readFileSync(f, "utf8")),
    );
    expect(all.length).toBeGreaterThanOrEqual(11);
  });

  it("every accessibilityState `selected` has an aria-pressed / aria-checked partner", () => {
    expect(offenders).toEqual([]);
  });
});
