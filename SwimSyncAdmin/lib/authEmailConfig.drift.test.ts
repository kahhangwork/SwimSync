import { describe, it, expect } from "vitest";
// Supabase's AUTH emails are configured in `supabase/config.toml`, not in app code,
// so nothing in either app's test suite could previously see them. This file scans
// that file and the templates it points at.
//
// It exists for ONE assertion above all the others: `enable_confirmations` must stay
// FALSE. Signup confirmation was switched off deliberately — with it on, a parent
// registering on the web tapped the emailed link, landed in a SECOND browser tab, and
// left the original tab sitting on "check your email" forever. They never came back.
// The setting has no other guard: it lives on the same Supabase dashboard page as the
// email templates, one line away from the branded confirmation copy, so the moment
// most likely to flip it by accident is the moment someone pastes that copy in.
// `supabase config push` would carry a local flip straight to production.
//
// The confirmation template is therefore DORMANT ON PURPOSE. It is written and wired
// so that turning confirmation on some day is one decision rather than a scramble;
// it is not evidence that anyone intends to.
//
// The rest of the checks stop a branded template from quietly becoming a non-template:
// a renamed file leaves `content_path` pointing at nothing and Supabase silently falls
// back to its own stock default, which is the exact plain-text email this work removed.
//
// ⚠ Strip HTML comments BEFORE scanning a template. Both templates DESCRIBE the
// external-asset rule in their own header ("email clients strip <style>/remote
// resources"), so a scanner that reads the comments flags the sentence warning against
// the thing as the thing. That is §7.230's allowlist trap in miniature.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// This file lives in SwimSyncAdmin/lib, so the repo root is two levels up.
const ROOT = join(__dirname, "..", "..");
const CONFIG = join(ROOT, "supabase", "config.toml");

/** Drop a trailing `# comment`, but not a `#` inside a quoted value. */
function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#") {
      return value.slice(0, i);
    }
  }
  return value;
}
/**
 * Minimal section-aware TOML reader — enough for `key = value` under `[section]`,
 * which is all this file needs. A bare regex over the whole file cannot do it:
 * `enable_confirmations = false` appears under BOTH `[auth.email]` and `[auth.sms]`,
 * and only the first one is the stranding toggle.
 *
 * Known limit: `[[array.of.tables]]` headers are ignored. `config.toml` has none,
 * and none would carry a key this file reads.
 */
function readToml(path: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = "";
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1];
      out[section] ??= {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (kv && section) {
      out[section] ??= {};
      // Strip the inline comment BEFORE unquoting: someone documenting the
      // stranding toggle in place (`= false # do not change`) must not redden CI
      // while the value is still false. A guard that cries wolf gets ignored.
      const value = stripInlineComment(kv[2]).trim();
      out[section][kv[1]] = value.replace(/^"(.*)"$/, "$1");
    }
  }
  return out;
}

/** The template body, with HTML comments removed — see the ⚠ note above. */
function templateBody(relPath: string): string {
  return readFileSync(join(ROOT, relPath.replace(/^\.\//, "")), "utf8").replace(
    /<!--[\s\S]*?-->/g,
    "",
  );
}

/**
 * Root variable names used by every `{{ ... }}` action in a template.
 *
 * Two things a naive `/\{\{\s*\.(\w+)/` misses, both proven before this was written:
 *   - `{{ if .Emial }}` captures NOTHING — the action does not open with the dot, so a
 *     typo inside a conditional would slip past the whitelist entirely.
 *   - `{{ .Data.foo }}` captures BOTH `Data` and `foo` — the leaf of a dotted path is
 *     not a top-level var, and whitelisting it would mean whitelisting every leaf.
 * So: find the actions first, then take only path ROOTS inside them.
 */
function templateVars(body: string): string[] {
  return [...body.matchAll(/\{\{([\s\S]*?)\}\}/g)].flatMap((action) =>
    [...action[1].matchAll(/(?<![\w.])\.(\w+)/g)].map((m) => m[1]),
  );
}

// Vars Supabase exposes to an auth email template. A typo outside this set renders
// empty, so the parent gets a button that goes nowhere.
const ALLOWED_VARS = new Set([
  "ConfirmationURL",
  "Token",
  "TokenHash",
  "SiteURL",
  "Email",
  "RedirectTo",
  "Data",
]);

const BRANDED_TEMPLATES = [
  { section: "auth.email.template.recovery", label: "password reset" },
  { section: "auth.email.template.confirmation", label: "signup confirmation" },
];

describe("supabase auth email config", () => {
  const toml = readToml(CONFIG);

  it("keeps signup confirmation OFF — it stranded web parents once", () => {
    // If [auth.email] is ever renamed, this fails rather than passing vacuously.
    expect(toml["auth.email"], "[auth.email] section is missing").toBeDefined();
    expect(toml["auth.email"].enable_confirmations).toBe("false");
  });

  for (const { section, label } of BRANDED_TEMPLATES) {
    describe(`${label} template`, () => {
      // Fail with the same named message the wiring test gives, rather than a
      // TypeError raised deep inside `.replace()` on an undefined path.
      const contentPath = (): string => {
        const rel = toml[section]?.content_path;
        expect(rel, `[${section}] has no content_path`).toBeTruthy();
        return rel as string; // the expect() above has thrown if it was absent

      };

      it("is wired to a file that exists", () => {
        const block = toml[section];
        expect(block, `[${section}] is missing from config.toml`).toBeDefined();
        expect(block.subject, `[${section}] has no subject`).toBeTruthy();
        const rel = contentPath();
        expect(
          existsSync(join(ROOT, rel.replace(/^\.\//, ""))),
          `${rel} does not exist — Supabase would silently send its stock default`,
        ).toBe(true);
      });

      it("links somewhere and uses only real Supabase vars", () => {
        const body = templateBody(contentPath());
        expect(body).toContain("{{ .ConfirmationURL }}");
        const used = templateVars(body);
        expect(used.length).toBeGreaterThan(0);
        expect(used.filter((v) => !ALLOWED_VARS.has(v))).toEqual([]);
      });

      it("carries no external assets — email clients strip them", () => {
        const body = templateBody(contentPath());
        expect(body).not.toMatch(/<style[\s>]/i);
        expect(body).not.toMatch(/<link[\s>]/i);
        expect(body).not.toMatch(/src\s*=\s*["']https?:/i);
      });
    });
  }
});
