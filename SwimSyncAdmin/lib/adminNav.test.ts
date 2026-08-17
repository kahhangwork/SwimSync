import { describe, it, expect } from "vitest";
import {
  NAV,
  navFor,
  hasTenant,
  landingRoute,
  scopeForPath,
  groupedNavFor,
  groupIdForPath,
  NAV_GROUPS,
  TOP_LEVEL_HREFS,
} from "./adminNav";

// The seeded production shape: the real coach holds tenant_admin AND a coaches
// row (a tenant of one). These tests exist mostly to pin that they are treated
// as an ordinary business admin — branching on role instead is what locked them
// out of production once already (`docs/GOTCHAS.md` §7.19).
const A_TENANT = "11111111-1111-1111-1111-111111111111";

describe("hasTenant", () => {
  it("is true only for a real id", () => {
    expect(hasTenant(A_TENANT)).toBe(true);
    expect(hasTenant(null)).toBe(false);
    expect(hasTenant(undefined)).toBe(false);
  });

  it("treats an empty string as no business", () => {
    // A blank column is not a business, and `""` is falsy in a way that is easy
    // to lose through a `?? ""` somewhere upstream.
    expect(hasTenant("")).toBe(false);
  });
});

describe("navFor", () => {
  it("gives a business admin the seventeen business pages and NOT Platform", () => {
    const hrefs = navFor(A_TENANT).map((n) => n.href);
    // 11 + Packages (2026-07-20) + Trials (2026-07-25) + Parent Requests
    // (2026-07-26) + Make-ups (2026-08-02) + Admins (2026-08-06) + Lesson
    // Coaches (2026-08-11) + Holidays (2026-08-15) + Referrals (2026-08-15).
    // The count is asserted
    // deliberately: NAV also drives RequiresTenant's route gate, so a page added
    // here without being thought about is a page gated by accident rather than
    // on purpose.
    expect(hrefs).toHaveLength(20);
    expect(hrefs).toContain("/history");
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).toContain("/wages");
    expect(hrefs).toContain("/packages");
    expect(hrefs).toContain("/holidays");
    expect(hrefs).toContain("/claims");
    expect(hrefs).toContain("/admins");
    expect(hrefs).toContain("/substitutes");
    expect(hrefs).not.toContain("/platform");
  });

  it("gives a platform admin ONLY Platform", () => {
    const hrefs = navFor(null).map((n) => n.href);
    expect(hrefs).toEqual(["/platform"]);
  });

  it("never returns both scopes at once", () => {
    for (const tenantId of [A_TENANT, null]) {
      const scopes = new Set(navFor(tenantId).map((n) => n.scope));
      expect(scopes.size).toBe(1);
    }
  });

  it("covers every NAV entry between the two audiences, so none is orphaned", () => {
    // A new entry with a mistyped scope would otherwise show to nobody, and
    // nothing else would notice.
    const total = navFor(A_TENANT).length + navFor(null).length;
    expect(total).toBe(NAV.length);
  });
});

describe("landingRoute", () => {
  it("sends a business admin to their dashboard", () => {
    expect(landingRoute(A_TENANT)).toBe("/dashboard");
  });

  it("sends a platform admin straight to Platform", () => {
    // /dashboard would show them cross-tenant totals labelled as one business,
    // which is the whole reason this exists.
    expect(landingRoute(null)).toBe("/platform");
  });

  it("never lands anyone on a page their nav does not contain", () => {
    for (const tenantId of [A_TENANT, null]) {
      const hrefs = navFor(tenantId).map((n) => n.href);
      expect(hrefs).toContain(landingRoute(tenantId));
    }
  });
});

describe("scopeForPath", () => {
  it("classifies the business pages as tenant-scoped", () => {
    expect(scopeForPath("/dashboard")).toBe("tenant");
    expect(scopeForPath("/students")).toBe("tenant");
    expect(scopeForPath("/wages")).toBe("tenant");
  });

  it("classifies /platform as platform-scoped", () => {
    expect(scopeForPath("/platform")).toBe("platform");
  });

  it("gives a detail route its section's scope", () => {
    // /classes/<id> is still a business page; it must not fall through to the
    // unknown-path branch and be gated by accident of URL shape.
    expect(scopeForPath("/classes/abc-123")).toBe("tenant");
    expect(scopeForPath("/students/abc-123/edit")).toBe("tenant");
  });

  it("FAILS CLOSED on an unknown path", () => {
    // A page nobody added to NAV is far likelier to be another business page
    // than a cross-tenant one, and being wrong this way shows a refusal rather
    // than leaking one tenant's rows to another.
    expect(scopeForPath("/some-new-page")).toBe("tenant");
    expect(scopeForPath("/")).toBe("tenant");
  });

  it("does not let a prefix collision steal another route", () => {
    // "/platformish" must not match "/platform".
    expect(scopeForPath("/platformish")).toBe("tenant");
  });
});

describe("Trials", () => {
  // Booking a trial is a one-business action, and a platform admin belongs to
  // no business — the page would have nothing to be about (PRD §4.4).
  it("is offered to a business admin", () => {
    expect(navFor(A_TENANT).map((i) => i.href)).toContain("/trials");
  });

  it("is NOT offered to the platform admin", () => {
    expect(navFor(null).map((i) => i.href)).not.toContain("/trials");
  });
});

describe("Make-ups", () => {
  // Same reasoning as Trials: booking a make-up is a one-business action.
  it("is offered to a business admin", () => {
    expect(navFor(A_TENANT).map((i) => i.href)).toContain("/makeups");
  });

  it("is NOT offered to the platform admin", () => {
    expect(navFor(null).map((i) => i.href)).not.toContain("/makeups");
  });
});

describe("sidebar grouping (presentation layer over NAV)", () => {
  const groupHrefs = NAV_GROUPS.flatMap((g) => g.hrefs);
  const navHrefs = new Set(NAV.map((n) => n.href));

  it("every group href is a real NAV entry (no dangling href drops a page)", () => {
    for (const href of groupHrefs) expect(navHrefs.has(href)).toBe(true);
  });

  it("no href is claimed by two groups, or by a group AND the top level", () => {
    const all = [...groupHrefs, ...TOP_LEVEL_HREFS];
    expect(new Set(all).size).toBe(all.length);
  });

  it("partitions the tenant nav with nothing lost or duplicated", () => {
    // The grouped twin of navFor's "none is orphaned" test: topLevel + every
    // group item together must equal navFor(A_TENANT) exactly.
    const g = groupedNavFor(A_TENANT);
    const seen = [
      ...g.topLevel.map((n) => n.href),
      ...g.groups.flatMap((x) => x.items.map((n) => n.href)),
    ];
    expect(seen.length).toBe(navFor(A_TENANT).length);
    expect(new Set(seen)).toEqual(new Set(navFor(A_TENANT).map((n) => n.href)));
  });

  it("EVERY tenant page has a deliberate home — top-level or a group", () => {
    // The fail-safe pin: adding page #21 without deciding its home leaves it in
    // topLevel, which is fine to SHIP but must be a conscious choice. This test
    // (like navFor's count-of-20) makes an accidental addition visible.
    const homed = new Set([...groupHrefs, ...TOP_LEVEL_HREFS]);
    const orphans = navFor(A_TENANT)
      .map((n) => n.href)
      .filter((href) => !homed.has(href));
    expect(orphans).toEqual([]);
  });

  it("leads the top level with the four daily pages, in order", () => {
    const g = groupedNavFor(A_TENANT);
    expect(g.topLevel.slice(0, 4).map((n) => n.href)).toEqual([
      "/dashboard",
      "/students",
      "/classes",
      "/attendance",
    ]);
  });

  it("gives a platform admin one top-level Platform link and no groups", () => {
    const g = groupedNavFor(null);
    expect(g.topLevel.map((n) => n.href)).toEqual(["/platform"]);
    expect(g.groups).toEqual([]);
  });

  it("renders nothing while the tenant is still unresolved", () => {
    // Mirrors the Sidebar guard: undefined means "not looked up yet", and
    // navFor(undefined) would otherwise return the platform link and flash it.
    // groupedNavFor is not called with undefined by the component, but confirm
    // the group set is empty so an accidental call cannot show a stray header.
    const g = groupedNavFor(undefined);
    expect(g.groups).toEqual([]);
  });
});

describe("groupIdForPath (auto-expand the active group)", () => {
  it("maps a page to its group", () => {
    expect(groupIdForPath("/invoices")).toBe("billing");
    expect(groupIdForPath("/claims")).toBe("families");
    expect(groupIdForPath("/holidays")).toBe("scheduling");
    expect(groupIdForPath("/history")).toBe("settings");
  });

  it("opens the group for a detail route", () => {
    expect(groupIdForPath("/invoices/abc-123")).toBe("billing");
  });

  it("returns null for a top-level page or the platform link", () => {
    expect(groupIdForPath("/dashboard")).toBeNull();
    expect(groupIdForPath("/students")).toBeNull();
    expect(groupIdForPath("/platform")).toBeNull();
  });

  it("does not let a prefix collision open the wrong group", () => {
    // "/invoicesish" must not match "/invoices".
    expect(groupIdForPath("/invoicesish")).toBeNull();
  });
});
