// Where a signed-in user lands in the MOBILE app.
//
// THE RULE: capability comes from which extension rows exist, not from the role
// enum alone. A PRIVATE COACH holds `tenant_admin` (they own their business)
// AND has a `coaches` row (they teach in it) — so gating the coach UI on
// `role === "coach"` locks them out of their own app.
//
// That is not hypothetical: it happened in production. The tenancy backfill
// converted the only real coach to `tenant_admin`, and the next time they
// opened the app they got "Unrecognised role. Please contact support." The
// design had always said to route on the coaches row; the routing just never
// got the memo.
//
// Pure so it can be unit-tested — the callers do the two lookups and pass the
// answers in.

export type LandingRole =
  | "parent"
  | "coach"
  | "tenant_admin"
  | "platform_admin"
  | string
  | null
  | undefined;

export type Landing =
  | { route: "/(parent)/home" }
  | { route: "/(coach)/today" }
  /** No mobile home for this account; `reason` is shown to the user. */
  | { route: null; reason: string };

/**
 * @param role     profiles.role
 * @param isCoach  whether a `coaches` row exists for this profile
 * @param isParent whether a `parents` row exists for this profile
 */
export function landingFor(
  role: LandingRole,
  isCoach: boolean,
  isParent: boolean = role === "parent"
): Landing {
  // A parent is a parent regardless of anything else.
  if (role === "parent" || isParent) return { route: "/(parent)/home" };

  // Anyone who actually teaches gets the coach app — `coach` and the
  // private-coach `tenant_admin` alike.
  if (isCoach) return { route: "/(coach)/today" };

  // An admin who does not teach: real account, no mobile surface. Say that,
  // rather than "unrecognised role", which reads like their account is broken
  // and sends them to support for something working as intended.
  if (role === "tenant_admin" || role === "platform_admin") {
    return {
      route: null,
      reason:
        "Admin accounts use the web panel at admin.swimsync.sg — there's nothing to manage in the mobile app.",
    };
  }

  return {
    route: null,
    reason: "Unrecognised role. Please contact support.",
  };
}
