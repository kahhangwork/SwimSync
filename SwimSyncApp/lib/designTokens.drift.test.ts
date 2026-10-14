// TWIN FILE: SwimSyncAdmin/lib/designTokens.drift.test.ts is identical except that it
// imports the test API from vitest, loads that app's tailwind.config.ts and scans that
// app's source folders (SCAN). Keep in sync.
//
// DESIGN.md's front matter is the source of the visual tokens; each app's Tailwind
// config holds a hand copy (two deploy roots — neither can import from the repo
// root on Vercel). This fails when the copy and the source disagree, in either
// direction: a hex changed in DESIGN.md and not here, or here and not there.
//
// The front matter is read with a small line parser, not a YAML library: neither
// app depends on one, and the shape (`  key: "value"` under a top-level key) is
// what DESIGN.md's format fixes.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require("../tailwind.config.js");

const ROOT = join(__dirname, "..", "..");

/** `section` → { key: value } for the flat `  key: "value"` lines under it. */
function frontMatter(section: string): Record<string, string> {
  const fm = readFileSync(join(ROOT, "DESIGN.md"), "utf8").split(/^---$/m)[1];
  const out: Record<string, string> = {};
  let inside = false;
  for (const line of fm.split("\n")) {
    if (/^\S/.test(line)) inside = line.startsWith(`${section}:`);
    else if (inside) {
      const m = line.match(/^ {2}([\w-]+):\s*"([^"]*)"\s*$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

/** typography → { name: fontSize } (nested one level deeper than colors). */
function fontSizes(): Record<string, string> {
  const fm = readFileSync(join(ROOT, "DESIGN.md"), "utf8").split(/^---$/m)[1];
  const out: Record<string, string> = {};
  let inside = false;
  let current = "";
  for (const line of fm.split("\n")) {
    if (/^\S/.test(line)) inside = line.startsWith("typography:");
    else if (inside) {
      const name = line.match(/^ {2}([\w-]+):\s*$/);
      if (name) current = name[1];
      const size = line.match(/^ {4}fontSize:\s*"([^"]*)"/);
      if (size && current) out[current] = size[1];
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ext = (config as any).theme.extend;

/** DESIGN.md colour name → where this config keeps it. */
function configColour(name: string): string | undefined {
  const c = ext.colors;
  const status = name.match(/^status-(\w+)-(\w+)$/);
  if (status) return c.status?.[status[1]]?.[status[2]];
  const [head, tail] = name.split(/-(.+)/);
  const v = c[head];
  if (typeof v === "string") return tail ? undefined : v;
  return v?.[tail ?? "DEFAULT"];
}

describe("DESIGN.md tokens ↔ tailwind config", () => {
  const colours = frontMatter("colors");

  it("the parser found DESIGN.md's colours (guards a silent zero-row pass)", () => {
    expect(Object.keys(colours).length).toBeGreaterThanOrEqual(26);
  });

  it.each(Object.entries(frontMatter("colors")))("colour %s = %s", (name, hex) => {
    expect(configColour(name)?.toLowerCase()).toBe(hex.toLowerCase());
  });

  it("radii: DESIGN sm/md/lg are rounded-tag/-control/-card", () => {
    const r = frontMatter("rounded");
    expect(ext.borderRadius).toEqual({ tag: r.sm, control: r.md, card: r.lg });
  });

  it("type sizes match, and every DESIGN size has a class", () => {
    const sizes = fontSizes();
    expect(Object.keys(sizes).length).toBeGreaterThanOrEqual(5);
    for (const [name, px] of Object.entries(sizes)) {
      expect([name, ext.fontSize[name]?.[0]]).toEqual([name, px]);
    }
  });
});

// UI restyle 7.1 (⚠ RISK 10): only DESIGN.md's token classes may colour the UI. Tailwind
// drops an unknown class SILENTLY, so nothing else would notice one reappearing: this
// fails on any Tailwind DEFAULT-PALETTE colour class (`bg-sky-500`, `text-gray-900`,
// `border-red-200`, …) and on any `-primary-<shade>` (the deleted legacy sky shades).
// White / black / transparent / current carry no shade and are not matched.
// ALLOWLIST — extend only with a one-line reason here and in UI_RESTYLE_PLAN.md §7:
//   lib/classColours.ts — the class colour palette is TENANT DATA (`classes.colour`
//   keys), never restyled (⚠ RISK 9). Admin only.
// TWIN: SwimSyncAdmin/lib/designTokens.drift.test.ts holds the same guard.
// MUTATION PROOF (§7.25): add `bg-sky-500` to any components/ file → RED.
const SCAN = ["app", "components", "features", "lib"];
const ALLOW = new Set(["lib/classColours.ts"]);
const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const BANNED = new RegExp(
  `[\\w:]*\\b(?:bg|text|border|ring|divide|outline|fill|stroke|from|to|via|placeholder|decoration)-(?:(?:${PALETTE})-\\d{2,3}|primary-\\d+)\\b`,
  "g",
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : sourceFiles(p);
    return /\.(tsx?|jsx?)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe("no Tailwind default-palette colour classes outside the allowlist", () => {
  const root = join(__dirname, "..");
  const files = SCAN.flatMap((d) => sourceFiles(join(root, d)));

  it("scanned the source (guards a silent zero-row pass)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("the pattern catches what it must (guards a pattern that matches nothing)", () => {
    const probe = "bg-sky-500 hover:text-gray-900 border-red-200 bg-primary-500 bg-primary text-white";
    expect(probe.match(BANNED)).toEqual(["bg-sky-500", "hover:text-gray-900", "border-red-200", "bg-primary-500"]);
  });

  it("zero banned classes", () => {
    const hits = files
      .filter((f) => !ALLOW.has(relative(root, f).split(sep).join("/")))
      .flatMap((f) => (readFileSync(f, "utf8").match(BANNED) ?? []).map((c) => `${relative(root, f)}: ${c}`));
    expect(hits).toEqual([]);
  });
});
