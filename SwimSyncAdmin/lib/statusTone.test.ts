import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusTone } from "@/lib/statusTone";

// DESIGN.md → Status scale: one meaning per colour, in all three apps.
describe("statusTone", () => {
  it.each([
    ["Paid", "success"], ["Present", "success"], ["Assigned", "success"], ["Closed", "success"],
    ["Claimed", "info"], ["Pending", "info"], ["Reserved", "info"],
    ["Outstanding", "warning"], ["Unassigned", "warning"],
    ["Overdue", "danger"],
    ["Absent", "neutral"], ["Inactive", "neutral"], ["Expired", "neutral"],
  ] as const)("%s → %s", (word, tone) => {
    expect(statusTone(word)).toBe(tone);
  });

  it("an unpaid invoice is never red (the Red Means Stuck Rule)", () => {
    expect(statusTone("Outstanding")).not.toBe("danger");
  });

  it("a qualified word takes its head word's tone", () => {
    expect(statusTone("Cancelled (Rain)")).toBe("neutral");
    expect(statusTone("Trial (Paid)")).toBe("info");
    expect(statusTone("Void · duplicate")).toBe("neutral");
  });

  it("an unknown word is neutral — never invent urgency", () => {
    expect(statusTone("Whatever")).toBe("neutral");
    expect(statusTone("")).toBe("neutral");
  });
});

// TWIN FILE rule: SwimSyncApp/lib/statusTone.ts must say the same thing, or a
// parent and an admin see one invoice in two colours.
describe("statusTone twin", () => {
  it("both apps' copies are identical apart from line 3 (the pointer)", () => {
    const ROOT = join(__dirname, "..", "..");
    const read = (p: string) => readFileSync(join(ROOT, p), "utf8").split("\n");
    const admin = read("SwimSyncAdmin/lib/statusTone.ts");
    const app = read("SwimSyncApp/lib/statusTone.ts");
    expect(admin[2]).toContain("SwimSyncApp/lib/statusTone.ts");
    expect(app[2]).toContain("SwimSyncAdmin/lib/statusTone.ts");
    admin.splice(2, 1);
    app.splice(2, 1);
    expect(app).toEqual(admin);
  });
});

// Every status word either app renders has a DECIDED tone — an explicit key (or
// its head word's), never the neutral fallback by default. A later rewording
// ("Not Marked" → "Not marked") then fails here instead of silently going grey.
//
// The words come from where they are made: the generated enums (invoice,
// assignment, claim), the admin's attendance labels, the CHECK lists below (read
// from the live constraints 2026-10-13 — pg_constraint, §7.40), and every
// literal `status="…"` passed to a StatusBadge in either app's source.
//
// MUTATION PROOF (§7.25): delete `Reversed: "neutral",` from both twins
// → RED: "every rendered status word has a decided tone" (run 2026-10-13).
import { readdirSync } from "node:fs";
import { knownTone } from "@/lib/statusTone";
import { STATUS_LABELS } from "@/app/(admin)/attendance/constants";

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function enumValues(name: string): string[] {
  const src = readFileSync(join(__dirname, "database.types.ts"), "utf8");
  const m = src.match(new RegExp(`"${name}": ((?:"[^"]*"\\|?)+)`));
  return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : [];
}

/** CHECK (status IN …) lists — text columns, so not in the generated enums. */
const CHECKS = {
  credit_notes: ["available", "applied", "reversed"],
  parent_packages: ["pending", "active", "cancelled"],
  referrals: ["pending", "converted", "void"],
  referral_rewards: ["available", "reserved", "used", "expired", "void"],
};

function badgeLiterals(): string[] {
  const ROOT = join(__dirname, "..", "..");
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = join(d, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
      return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
    });
  const files = ["SwimSyncAdmin/app", "SwimSyncApp/app", "SwimSyncApp/features"].flatMap((d) => walk(join(ROOT, d)));
  return files.flatMap((f) => {
    const src = readFileSync(f, "utf8");
    if (!src.includes("StatusBadge")) return [];
    // `<StatusBadge status="Disabled"` and the string literals inside a
    // `status={…}` expression ("Outstanding" : "Paid", "Claimed", …).
    const direct = [...src.matchAll(/<StatusBadge\s+status="([^"]+)"/g)].map((m) => m[1]);
    const inExpr = [...src.matchAll(/<StatusBadge\s+status=\{([\s\S]*?)\}\s*(?:size|tone|\/>)/g)].flatMap((m) =>
      [...m[1].matchAll(/"([A-Z][^"]*)"/g)].map((x) => x[1]),
    );
    return [...direct, ...inExpr];
  });
}

describe("every rendered status word has a decided tone", () => {
  const enums = ["invoice_status", "assignment_status", "claim_status"].map((n) => [n, enumValues(n)] as const);
  const literals = badgeLiterals();

  it("found the sources (guards a silent zero-row pass)", () => {
    for (const [n, v] of enums) expect([n, v.length >= 2]).toEqual([n, true]);
    expect(Object.keys(STATUS_LABELS).length).toBeGreaterThanOrEqual(7);
    // Outstanding, Paid, Claimed, Disabled, Active, Inactive, Applied, Available, Converted, Pending …
    expect(new Set(literals).size).toBeGreaterThanOrEqual(10);
  });

  const words = new Set<string>([
    ...enums.flatMap(([, v]) => v.map(cap)),
    ...Object.values(STATUS_LABELS),
    ...Object.values(CHECKS).flat().map(cap),
    ...badgeLiterals(),
    // Billing months (BillingMonthsCard passes its own tone, but the word still has one).
    "Closed", "Open", "Not billed yet", "Not run yet", "Nothing to bill",
    // The parent app's attendance dash.
    "Not Marked",
  ]);

  it.each([...words].sort())("%s", (w) => {
    expect([w, knownTone(w)]).toEqual([w, expect.any(String)]);
  });
});
