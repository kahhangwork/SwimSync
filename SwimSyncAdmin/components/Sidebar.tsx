"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import {
  groupedNavFor,
  groupIdForPath,
  NAV_GROUPS,
  type NavItem,
} from "@/lib/adminNav";

// Persisted open-group set. Multi-open (not accordion) — the real workflows hop
// between groups (approve a claim → check the invoice run), and slamming one
// drawer shut when another opens punishes exactly that.
const NAV_OPEN_KEY = "swimsync-admin-nav-open";

// The two amber badges are, per the code below, "the only thing that tells them
// a family is stuck" — nothing emails the admin. When a badged page is hidden
// inside a collapsed group its count MUST bubble to the group header, or the
// signal is lost. Titles carry the magnitude the tooltip has always shown.
function badgeTitle(href: string, count: number): string {
  if (href === "/invoices") {
    return `${count} lesson line${count === 1 ? "" : "s"} recorded after billing — nobody has been billed for them`;
  }
  if (href === "/claims") {
    return `${count} parent${count === 1 ? " is" : "s are"} waiting — they cannot add that child until you decide`;
  }
  return `${count}`;
}



export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  // undefined = not resolved yet. Distinct from null (= no business, i.e. a
  // platform admin): rendering the business nav while we still don't know
  // flashes eleven links at a platform admin before removing them.
  const [tenantId, setTenantId] = useState<string | null | undefined>(undefined);
  // Claims waiting on this business. A parent who files one is BLOCKED from
  // adding that child until it is decided, and nothing emails the admin about
  // it (PARENT_CLAIM_PLAN decision 7) — so this count is the only thing that
  // tells them a family is stuck. Re-read on navigation, since deciding a
  // claim should drop the badge without a page reload.
  const [pendingClaims, setPendingClaims] = useState(0);
  // Lessons recorded into an already-BILLED month, waiting to be settled
  // (Wave 4). Same reasoning as the claims badge: nothing emails the admin
  // about these, the report only renders on the Invoices page, and an admin
  // who isn't billing right now may not open that page for weeks — this count
  // is what makes the silence visible from anywhere. Re-read on navigation so
  // settling a line drops it without a reload.
  const [orphanLines, setOrphanLines] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      setUserEmail(data.session.user.email ?? null);
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, tenant_id")
        .eq("id", data.session.user.id)
        .single();
      setUserName(profile?.full_name ?? null);
      setTenantId((profile?.tenant_id as string | null) ?? null);
    });
  }, []);

  useEffect(() => {
    // The RPC authorises per tenant (platform admins have none — skip).
    if (!tenantId) return;
    supabase
      .rpc("unbilled_sealed_lessons", { p_tenant: tenantId })
      .then(({ data }) => setOrphanLines((data ?? []).length));
  }, [pathname, tenantId]);

  useEffect(() => {
    // No tenant filter needed: student_claims_select already scopes this to the
    // caller's own business, and adding a second copy of that rule here would
    // be one more place for it to drift.
    supabase
      .from("student_claims")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => setPendingClaims(count ?? 0));
  }, [pathname]);

  // Which groups are expanded. Starts empty (all collapsed — the whole point),
  // then hydrated from localStorage in an effect (SSR-safe, same shape as the
  // session read above). Unknown/stale ids are filtered against the live groups.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_OPEN_KEY);
      if (!raw) return;
      const known = new Set(NAV_GROUPS.map((g) => g.id));
      const ids = (JSON.parse(raw) as string[]).filter((id) => known.has(id));
      setOpenGroups(new Set(ids));
    } catch {
      /* malformed storage — start collapsed */
    }
  }, []);

  // Auto-expand the group holding the active page, on every navigation. A manual
  // collapse is respected until the route changes (pathname is the dependency),
  // so toggling a group shut while staying on the page sticks.
  useEffect(() => {
    const id = groupIdForPath(pathname);
    if (!id) return;
    setOpenGroups((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(NAV_OPEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [pathname]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(NAV_OPEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const initial = (userName ?? userEmail ?? "A").charAt(0).toUpperCase();

  // Badge counts keyed by href, so a link and a collapsed group header read the
  // same source. Extend this map (not the JSX) if a third badge is ever added.
  const badges: Record<string, number> = {
    "/invoices": orphanLines,
    "/claims": pendingClaims,
  };

  const grouped =
    tenantId === undefined
      ? { topLevel: [] as NavItem[], groups: [] as ReturnType<typeof groupedNavFor>["groups"] }
      : groupedNavFor(tenantId);

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderLink(item: NavItem) {
    const active = isActive(item.href);
    const Icon = item.icon;
    const count = badges[item.href] ?? 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          active
            ? "bg-sky-50 text-sky-700"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            active ? "text-sky-600" : "text-gray-400"
          )}
        />
        {item.label}
        {count > 0 && (
          <span
            className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white"
            title={badgeTitle(item.href, count)}
          >
            {count}
          </span>
        )}
      </Link>
    );
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
        <Logo size="sm" />
        <div>
          <p className="text-base font-bold text-gray-900">SwimSync</p>
          <p className="text-xs text-gray-400">Admin Panel</p>
        </div>
      </div>

      {/* Navigation — top-level daily pages, then collapsible task groups. */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {grouped.topLevel.map(renderLink)}

        {grouped.groups.map(({ group, items }) => {
          const open = openGroups.has(group.id);
          const containsActive = items.some((it) => isActive(it.href));
          // Sum the children's badges onto the collapsed header. In this IA each
          // badged page sits in a different group, so the sum is one child's
          // exact count — but summing keeps it correct if a third badge appears.
          const badged = items.filter((it) => (badges[it.href] ?? 0) > 0);
          const groupCount = badged.reduce((n, it) => n + badges[it.href], 0);
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={open}
                aria-controls={`navgroup-${group.id}`}
                data-testid={`navgroup-${group.id}`}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  containsActive && !open
                    ? "text-sky-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "h-4 w-4 shrink-0 text-gray-400 transition-transform",
                    open ? "" : "-rotate-90"
                  )}
                />
                {group.label}
                {!open && groupCount > 0 && (
                  <span
                    data-testid={`navgroup-${group.id}-badge`}
                    className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white"
                    title={badged
                      .map((it) => badgeTitle(it.href, badges[it.href]))
                      .join("; ")}
                  >
                    {groupCount}
                  </span>
                )}
              </button>
              {open && (
                <div
                  id={`navgroup-${group.id}`}
                  role="list"
                  className="mt-0.5 space-y-0.5 pl-3"
                >
                  {items.map(renderLink)}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-100 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 text-sm font-bold">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {userName ?? "Admin"}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {userEmail ?? "—"}
            </p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
