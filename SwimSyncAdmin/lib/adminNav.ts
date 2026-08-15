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
} from "lucide-react";

/** A page's audience. `tenant` = shows ONE business. `platform` = cross-tenant. */
export type NavScope = "tenant" | "platform";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  scope: NavScope;
};

// Explicitly typed. Previously `platformOnly?: true` was inferred from the last
// element alone, so a typo on any other entry was silent — the flag simply did
// not exist on the type and nothing complained.
export const NAV: readonly NavItem[] = [
  { href: "/dashboard",    label: "Dashboard",            icon: LayoutDashboard, scope: "tenant"   },
  { href: "/unassigned",   label: "Unassigned Children",  icon: UserX,           scope: "tenant"   },
  { href: "/classes",      label: "Classes",              icon: Layers,          scope: "tenant"   },
  { href: "/students",     label: "Students",             icon: Users,           scope: "tenant"   },
  { href: "/claims",       label: "Parent Requests",      icon: UserCheck,       scope: "tenant"   },
  { href: "/levels",       label: "Swimming Levels",      icon: Waves,           scope: "tenant"   },
  { href: "/parents",      label: "Parents",              icon: UsersRound,      scope: "tenant"   },
  { href: "/attendance",   label: "Attendance",           icon: CalendarCheck,   scope: "tenant"   },
  { href: "/lesson-coaches", label: "Lesson Coaches",     icon: ArrowLeftRight,  scope: "tenant"   },
  { href: "/trials",       label: "Trials",               icon: Sparkles,        scope: "tenant"   },
  { href: "/makeups",      label: "Make-ups",             icon: RefreshCcw,      scope: "tenant"   },
  { href: "/invoices",     label: "Invoices",             icon: Receipt,         scope: "tenant"   },
  { href: "/packages",     label: "Packages",             icon: Package,         scope: "tenant"   },
  { href: "/referrals",    label: "Referrals",            icon: Gift,            scope: "tenant"   },
  { href: "/holidays",     label: "Holidays",             icon: CalendarX,       scope: "tenant"   },
  { href: "/credit-notes", label: "Credit Notes",         icon: FileText,        scope: "tenant"   },
  { href: "/coaches",      label: "Coaches",              icon: UserCog,         scope: "tenant"   },
  { href: "/admins",       label: "Admins",               icon: ShieldCheck,     scope: "tenant"   },
  { href: "/wages",        label: "Coach Wages",          icon: Wallet,          scope: "tenant"   },
  { href: "/platform",     label: "Platform",             icon: Globe,           scope: "platform" },
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
export function navFor(tenantId: string | null | undefined): NavItem[] {
  const scope: NavScope = hasTenant(tenantId) ? "tenant" : "platform";
  return NAV.filter((n) => n.scope === scope);
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
