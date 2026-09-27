// Which admin pages an account can use, and what the sidebar shows it.
//
// TWO QUESTIONS, TWO ANSWERS — and they are deliberately different:
//
// 1. "WHICH pages does this admin see?" — ask "does this account have a
//    BUSINESS?" (tenant_id), never the role. A platform admin belongs to no
//    business, and their RLS reach is every row across every tenant, so the
//    business pages don't error for them — they render several businesses'
//    data as though it were one, which is worse than an error. A private coach
//    holds `tenant_admin` *and* a `coaches` row (a tenant of one); gating THIS
//    question on a role comparison is what shipped "Unrecognised role" to the
//    only real coach in production (`docs/GOTCHAS.md` §7.19). tenant_id
//    answers it directly, mirroring `current_tenant_id()` server-side.
//
// 2. "May this account enter the panel AT ALL?" — that one IS role, and lives
//    in components/RequiresTenant.tsx (since 20260806000100): a created coach
//    also has a tenant_id, so tenant_id cannot distinguish an admin from the
//    coach they hired. The §7.19 lesson survives in the check's SHAPE — refuse
//    only a RESOLVED, affirmatively non-admin role, never "not yet known".
//
// Pure so it can be unit-tested; callers do the lookup and pass the answer in.
// The mobile app's twin of this idea is SwimSyncApp/lib/landing.ts.

import type { LucideIcon } from "lucide-react";
import { can, type AdminArea, type Permissions } from "@/lib/permissions";
import {
  LayoutDashboard,
  UserX,
  Layers,
  Users,
  CalendarCheck,
  Sparkles,
  Receipt,
  FileText,
  UserCog,
  Wallet,
  Globe,
  UsersRound,
  Waves,
  Package,
  UserCheck,
  RefreshCcw,
  ShieldCheck,
  ArrowLeftRight,
  CalendarX,
  Gift,
  History,
  CalendarDays,
  ListChecks,
  Calculator,
  MapPin,
  ClipboardCheck,
  KeyRound,
} from "lucide-react";

/** A page's audience. `tenant` = shows ONE business. `platform` = cross-tenant. */
export type NavScope = "tenant" | "platform";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  scope: NavScope;
  /** The role area a co-admin needs at least VIEW on (ROLES_PERMISSIONS_PLAN.md
   *  §5.5). null = every admin (Dashboard — its tiles gate themselves) or not a
   *  tenant page at all (Platform). */
  area: AdminArea | null;
};

// Explicitly typed. Previously `platformOnly?: true` was inferred from the last
// element alone, so a typo on any other entry was silent — the flag simply did
// not exist on the type and nothing complained.
export const NAV: readonly NavItem[] = [
  { href: "/dashboard",    label: "Dashboard",            icon: LayoutDashboard, scope: "tenant", area: null },
  { href: "/unassigned",   label: "Unassigned",           icon: UserX,           scope: "tenant", area: "operations" },
  { href: "/classes",      label: "Classes",              icon: Layers,          scope: "tenant", area: "operations" },
  { href: "/students",     label: "Students",             icon: Users,           scope: "tenant", area: "operations" },
  { href: "/claims",       label: "Parent Requests",      icon: UserCheck,       scope: "tenant", area: "operations" },
  { href: "/assessment",   label: "Assessment",           icon: ClipboardCheck,  scope: "tenant", area: "operations" },
  { href: "/levels",       label: "Levels",               icon: Waves,           scope: "tenant", area: "operations" },
  { href: "/locations",    label: "Locations",            icon: MapPin,          scope: "tenant", area: "operations" },
  { href: "/parents",      label: "Parents",              icon: UsersRound,      scope: "tenant", area: "operations" },
  { href: "/attendance",   label: "Attendance Log",       icon: CalendarCheck,   scope: "tenant", area: "operations" },
  { href: "/calendar",     label: "Calendar",             icon: CalendarDays,    scope: "tenant", area: "operations" },
  { href: "/lessons",      label: "Lessons",              icon: ListChecks,      scope: "tenant", area: "operations" },
  { href: "/substitutes",  label: "Substitutes",          icon: ArrowLeftRight,  scope: "tenant", area: "operations" },
  { href: "/trials",       label: "Trials",               icon: Sparkles,        scope: "tenant", area: "operations" },
  { href: "/makeups",      label: "Make-ups",             icon: RefreshCcw,      scope: "tenant", area: "operations" },
  { href: "/invoices",     label: "Invoices",             icon: Receipt,         scope: "tenant", area: "billing" },
  { href: "/packages",     label: "Packages",             icon: Package,         scope: "tenant", area: "packages" },
  { href: "/referrals",    label: "Referrals",            icon: Gift,            scope: "tenant", area: "packages" },
  { href: "/holidays",     label: "Holidays",             icon: CalendarX,       scope: "tenant", area: "operations" },
  { href: "/credit-notes", label: "Credit Notes",         icon: FileText,        scope: "tenant", area: "billing" },
  { href: "/coaches",      label: "Coaches",              icon: UserCog,         scope: "tenant", area: "operations" },
  { href: "/admins",       label: "Admins",               icon: ShieldCheck,     scope: "tenant", area: "admins" },
  { href: "/roles",        label: "Roles",                icon: KeyRound,        scope: "tenant", area: "admins" },
  { href: "/wages",        label: "Wages",                icon: Wallet,          scope: "tenant", area: "wages" },
  // Gated by the accounting area (owner-only before roles). The owner passes
  // every area; the page and the RPCs refuse a role without it.
  { href: "/accounting",   label: "Accounting",           icon: Calculator,      scope: "tenant", area: "accounting" },
  { href: "/history",      label: "Change History",       icon: History,         scope: "tenant", area: "operations" },
  { href: "/platform",     label: "Platform",             icon: Globe,           scope: "platform", area: null },
];

/** Does this account administer a business? */
export function hasTenant(tenantId: string | null | undefined): boolean {
  return typeof tenantId === "string" && tenantId.length > 0;
}

/**
 * The sidebar for this account.
 *
 * A business's admin gets the business pages; a platform admin gets the
 * cross-tenant one. Nobody gets both — a platform admin has no business for the
 * tenant pages to be *about*.
 *
 * Hiding is an AFFORDANCE, not a boundary: the pages refuse in their own right
 * (see components/RequiresTenant.tsx), because a hidden link is still a URL.
 */
export function navFor(
  tenantId: string | null | undefined,
  perms?: Permissions
): NavItem[] {
  const scope: NavScope = hasTenant(tenantId) ? "tenant" : "platform";
  return NAV.filter(
    (n) => n.scope === scope && (!perms || n.area === null || can(perms, n.area, "view"))
  );
}

/**
 * The role area a URL belongs to (same prefix rule as scopeForPath), or null
 * for a page every admin may open. An UNKNOWN path returns "operations" — fail
 * closed onto an area, never onto "no area needed".
 */
export function areaForPath(pathname: string): AdminArea | null {
  const match = NAV.find(
    (n) => pathname === n.href || pathname.startsWith(n.href + "/")
  );
  return match ? match.area : "operations";
}

/**
 * What audience a URL belongs to, so the layout can gate every route from the
 * SAME declaration the sidebar renders from.
 *
 * Derived rather than listed a second time: a per-route allow-list maintained
 * beside NAV is two things to keep in sync, and the copy that gets forgotten is
 * always the security-relevant one.
 *
 * Prefix-matched (`/classes/abc` → the `/classes` entry) using the same rule as
 * the sidebar's active state, so detail routes inherit their section's scope.
 *
 * An UNKNOWN path returns "tenant" — fail closed. A new page nobody added to
 * NAV is far more likely to be another business page than a cross-tenant one,
 * and the cost of being wrong that way is a visible refusal rather than a
 * silent cross-tenant leak.
 */
export function scopeForPath(pathname: string): NavScope {
  const match = NAV.find(
    (n) => pathname === n.href || pathname.startsWith(n.href + "/")
  );
  return match?.scope ?? "tenant";
}

/**
 * Where this account lands after signing in.
 *
 * Derived from the same fact as everything else here, deliberately: a second
 * way of asking "which kind of admin is this?" is a second thing to keep in
 * sync, and the two disagreeing is how you get a redirect loop.
 */
export function landingRoute(tenantId: string | null | undefined): string {
  return hasTenant(tenantId) ? "/dashboard" : "/platform";
}

// ── Sidebar grouping — a PRESENTATION layer over NAV, never a replacement ─────
//
// NAV above stays the flat single source of truth that `scopeForPath()` gates
// every route from. The grouping below only references hrefs, so collapsing the
// sidebar into groups can NEVER move a route's security scope — the tempting
// "refactor NAV into nested groups" is exactly what would. Any tenant page not
// claimed by a group and not in TOP_LEVEL_HREFS renders top-level, ungrouped:
// a new page can never silently vanish from the sidebar (a unit test pins this).

export type NavGroup = {
  id: string;
  label: string;
  /** hrefs, in the order they display inside the group. */
  hrefs: readonly string[];
};

/** The daily loop — kept one click away, ungrouped. Order is display order. */
export const TOP_LEVEL_HREFS: readonly string[] = [
  "/dashboard",
  "/students",
  "/classes",
  "/calendar",
  "/lessons",
  // Top-level rather than under Settings, where /levels sits. Levels are setup —
  // the curriculum, edited once in a while. Assessment is WORK: an admin tours
  // every class doing it, and burying the tour behind a group header costs a
  // click on every class.
  "/assessment",
];

/** Task-based groups. See HANDOVER §3 for why the dormant pages sit here. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "families",   label: "Families",   hrefs: ["/trials", "/unassigned", "/claims", "/parents"] },
  { id: "billing",    label: "Billing",    hrefs: ["/invoices", "/credit-notes", "/packages", "/referrals", "/wages", "/accounting"] },
  { id: "scheduling", label: "Scheduling", hrefs: ["/makeups", "/substitutes", "/holidays"] },
  // The read-only records: the attendance audit (money axis, CSV) and change
  // history. Marking moved front-and-centre to /lessons on 2026-08-19; the log
  // is what you consult, not where you work.
  { id: "log",        label: "Log",        hrefs: ["/attendance", "/history"] },
  { id: "settings",   label: "Settings",   hrefs: ["/levels", "/locations", "/coaches", "/admins", "/roles"] },
];

export type GroupedNav = {
  topLevel: NavItem[];
  groups: { group: NavGroup; items: NavItem[] }[];
};

/**
 * The tenant sidebar, grouped. Calls `navFor()` FIRST so scope filtering lives
 * in exactly one place, then partitions its result: hrefs a group names go under
 * it (in the group's declared order); TOP_LEVEL_HREFS lead the top level; every
 * remaining unclaimed item — a future page, or the platform admin's lone
 * Platform link — follows, ungrouped. Empty groups are dropped, so a platform
 * admin renders no headers.
 */
export function groupedNavFor(
  tenantId: string | null | undefined,
  perms?: Permissions
): GroupedNav {
  const items = navFor(tenantId, perms);
  const byHref = new Map(items.map((n) => [n.href, n]));
  const claimed = new Set<string>();

  const groups = NAV_GROUPS.map((group) => {
    const groupItems = group.hrefs
      .map((href) => byHref.get(href))
      .filter((n): n is NavItem => n !== undefined);
    groupItems.forEach((n) => claimed.add(n.href));
    return { group, items: groupItems };
  }).filter((g) => g.items.length > 0);

  const preferred = TOP_LEVEL_HREFS
    .map((href) => byHref.get(href))
    .filter((n): n is NavItem => n !== undefined);
  preferred.forEach((n) => claimed.add(n.href));

  const rest = items.filter((n) => !claimed.has(n.href));
  return { topLevel: [...preferred, ...rest], groups };
}

/**
 * Which group (if any) a URL lives in — for auto-expanding the group that holds
 * the active page. Same prefix rule as the sidebar's active state, so
 * `/invoices/<id>` opens Billing.
 */
export function groupIdForPath(pathname: string): string | null {
  for (const group of NAV_GROUPS) {
    if (group.hrefs.some((h) => pathname === h || pathname.startsWith(h + "/"))) {
      return group.id;
    }
  }
  return null;
}
