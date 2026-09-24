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
  | { route: "/(coach)/schedule" }
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
  if (isCoach) return { route: "/(coach)/schedule" };

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

// Each landing's area in a WEB URL. Route groups are invisible there —
// `/(coach)/schedule` is served at `/schedule` — so a path is matched on its
// FIRST segment. landing.test.ts pins these lists to the folders under app/,
// so a new tab cannot silently fall outside its own area.
export const LANDING_SEGMENTS: Record<NonNullable<Landing["route"]>, readonly string[]> = {
  "/(parent)/home": ["home", "attendance", "billing", "profile"],
  "/(coach)/schedule": ["schedule", "classes", "pay", "settings"],
};

/**
 * Whether `pathname` is already a screen of `route`'s area — in which case the
 * session restore must leave it alone. Without this, every full-page load (a
 * refresh, a bookmark, a shared link) was replaced with the landing tab, and
 * the requested screen stayed mounted HIDDEN underneath (§7.254).
 *
 * `/login`, the bare `/` and the OTHER role's screens are outside, so they
 * still redirect — that is what the redirect is for.
 */
export function isInsideLanding(
  pathname: string,
  route: NonNullable<Landing["route"]>
): boolean {
  const first = pathname.split("/").filter(Boolean)[0];
  return first !== undefined && LANDING_SEGMENTS[route].includes(first);
}
