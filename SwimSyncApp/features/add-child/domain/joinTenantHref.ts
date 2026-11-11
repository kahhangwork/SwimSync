// Which stack the Join screen opens in. Add Child is reached from BOTH the Home
// tab (Add Child on the children list) and the Profile tab (Add Child Profile),
// and each tab owns a copy of the route (app/(parent)/{home,profile}/join-tenant).
// Pushing the Home copy from the Profile stack switched the tab bar to Home
// (BACKLOG *UI restyle leftovers* — "Join screen highlights Home").
//
// Pure, so it is tested without a router: pass useSegments().
export function joinTenantHref(segments: readonly string[]) {
  return segments.includes("profile")
    ? ("/(parent)/profile/join-tenant" as const)
    : ("/(parent)/home/join-tenant" as const);
}
