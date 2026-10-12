import { describe, it, expect } from "vitest";
// TWIN FILE: SwimSyncApp/lib/designTokens.drift.test.ts is identical except that it
// uses jest globals, loads that app's tailwind.config.js and scans that app's source
// folders (SCAN). Keep in sync.
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
import { join } from "node:path";
import config from "../tailwind.config";

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

// The legacy sky shades (`primary-50…900`) stay in the config until Phase 7, but
// DESIGN.md's Lane Blue is `primary` / `primary-hover` — a `bg-primary-500` written
// today is SKY, the wrong blue, and looks almost right. Zero in the source on
// 2026-10-12, so this is a ratchet that can only stay at zero (UI restyle 1.3).
// MUTATION PROOF (§7.25): add `bg-primary-500` to any components/ file → RED.
const SCAN = ["app", "components", "lib"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : sourceFiles(p);
    return /\.(tsx?|jsx?)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe("no legacy primary-<shade> classes", () => {
  const files = SCAN.flatMap((d) => sourceFiles(join(__dirname, "..", d)));

  it("scanned the source (guards a silent zero-row pass)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("zero `-primary-<number>` classes", () => {
    const hits = files.flatMap((f) =>
      (readFileSync(f, "utf8").match(/[\w:]*-primary-\d+\b/g) ?? []).map((c) => `${f}: ${c}`),
    );
    expect(hits).toEqual([]);
  });
});
