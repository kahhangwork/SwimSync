import { landingFor, type Landing } from "./landing";

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
    expect(landingFor("coach", true)).toEqual({ route: "/(coach)/today" });
  });

  // THE PRODUCTION REGRESSION. The tenancy backfill made the only real coach a
  // tenant_admin (they own their business and teach in it). Routing on the role
  // enum alone locked them out with "Unrecognised role".
  it("sends a PRIVATE COACH (tenant_admin with a coaches row) to the coach app", () => {
    expect(landingFor("tenant_admin", true)).toEqual({
      route: "/(coach)/today",
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
