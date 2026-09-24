import fs from "node:fs";
import path from "node:path";
import { landingFor, isInsideLanding, LANDING_SEGMENTS, type Landing } from "./landing";

/** Narrows the union so `reason` is reachable, and fails loudly if the call
 *  unexpectedly produced a route instead. */
function refusal(r: Landing): string {
  if (r.route !== null) {
    throw new Error(`expected a refusal, got route ${r.route}`);
  }
  return r.reason;
}

describe("landingFor", () => {
  it("sends a parent to the parent home", () => {
    expect(landingFor("parent", false)).toEqual({ route: "/(parent)/home" });
  });

  it("sends a plain coach to the coach app", () => {
    expect(landingFor("coach", true)).toEqual({ route: "/(coach)/schedule" });
  });

  // THE PRODUCTION REGRESSION. The tenancy backfill made the only real coach a
  // tenant_admin (they own their business and teach in it). Routing on the role
  // enum alone locked them out with "Unrecognised role".
  it("sends a PRIVATE COACH (tenant_admin with a coaches row) to the coach app", () => {
    expect(landingFor("tenant_admin", true)).toEqual({
      route: "/(coach)/schedule",
    });
  });

  it("tells a non-teaching tenant admin to use the web panel, not to contact support", () => {
    const reason = refusal(landingFor("tenant_admin", false));
    expect(reason).toContain("admin.swimsync.sg");
    expect(reason).not.toContain("Unrecognised");
  });

  it("tells the platform admin the same", () => {
    expect(refusal(landingFor("platform_admin", false))).toContain(
      "admin.swimsync.sg"
    );
  });

  it("still refuses a genuinely unknown role", () => {
    expect(refusal(landingFor("something_else", false))).toContain(
      "Unrecognised"
    );
  });

  it("treats a parents row as decisive even if the role says otherwise", () => {
    expect(landingFor("weird", false, true)).toEqual({
      route: "/(parent)/home",
    });
  });
});

// The session restore leaves a user on their OWN screens (a refresh, a
// bookmark, a shared link) and redirects everything else (§7.254).
describe("isInsideLanding", () => {
  const COACH = "/(coach)/schedule" as const;
  const PARENT = "/(parent)/home" as const;

  it("keeps a coach on the screen they refreshed — a deep attendance URL included", () => {
    expect(isInsideLanding("/classes/abc-123/attendance", COACH)).toBe(true);
    expect(isInsideLanding("/settings/change-password", COACH)).toBe(true);
    expect(isInsideLanding("/pay", COACH)).toBe(true);
    expect(isInsideLanding("/schedule", COACH)).toBe(true);
  });

  it("keeps a parent on their own screens", () => {
    expect(isInsideLanding("/home/child/xyz", PARENT)).toBe(true);
    expect(isInsideLanding("/billing/invoice/1", PARENT)).toBe(true);
  });

  it("still redirects from /login, the bare / and the auth screens", () => {
    for (const p of ["/login", "/", "", "/register", "/reset-password"]) {
      expect(isInsideLanding(p, COACH)).toBe(false);
      expect(isInsideLanding(p, PARENT)).toBe(false);
    }
  });

  it("still redirects a user off the OTHER role's screens", () => {
    expect(isInsideLanding("/home", COACH)).toBe(false);
    expect(isInsideLanding("/schedule", PARENT)).toBe(false);
  });

  it("matches the whole first segment, not a prefix", () => {
    expect(isInsideLanding("/classes-archive", COACH)).toBe(false);
    expect(isInsideLanding("/homework", PARENT)).toBe(false);
  });

  // A tab added under app/(coach) or app/(parent) but not listed would fall
  // outside its own area and bounce again on every refresh.
  it.each([
    ["/(coach)/schedule", "(coach)"],
    ["/(parent)/home", "(parent)"],
  ] as const)("%s lists exactly the folders under app/%s", (route, group) => {
    const dir = path.join(__dirname, "..", "app", group);
    const tabs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect([...LANDING_SEGMENTS[route]].sort()).toEqual(tabs);
  });
});
