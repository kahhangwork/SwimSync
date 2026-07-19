import { describe, it, expect } from "vitest";
import { NAV, navFor, hasTenant, landingRoute, scopeForPath } from "./adminNav";

// The seeded production shape: the real coach holds tenant_admin AND a coaches
// row (a tenant of one). These tests exist mostly to pin that they are treated
// as an ordinary business admin — branching on role instead is what locked them
// out of production once already (HANDOVER §7.19).
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
  it("gives a business admin the eleven business pages and NOT Platform", () => {
    const hrefs = navFor(A_TENANT).map((n) => n.href);
    expect(hrefs).toHaveLength(11);
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).toContain("/wages");
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
