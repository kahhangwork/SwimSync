"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  UserX,
  Layers,
  Users,
  CalendarCheck,
  Receipt,
  FileText,
  UserCog,
  Wallet,
  Globe,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",           icon: LayoutDashboard },
  { href: "/unassigned",   label: "Unassigned Children", icon: UserX           },
  { href: "/classes",      label: "Classes",              icon: Layers          },
  { href: "/students",     label: "Students",             icon: Users           },
  { href: "/attendance",   label: "Attendance",           icon: CalendarCheck   },
  { href: "/invoices",     label: "Invoices",             icon: Receipt         },
  { href: "/credit-notes", label: "Credit Notes",         icon: FileText        },
  { href: "/coaches",      label: "Coaches",              icon: UserCog         },
  { href: "/wages",        label: "Coach Wages",          icon: Wallet          },
  // Platform admin only — hidden for a tenant admin, who has one business and
  // nothing cross-tenant to do. The page enforces this itself too; hiding it
  // is the affordance, not the boundary.
  { href: "/platform",     label: "Platform",             icon: Globe, platformOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      setUserEmail(data.session.user.email ?? null);
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", data.session.user.id)
        .single();
      setUserName(profile?.full_name ?? null);
      setIsPlatformAdmin(profile?.role === "platform_admin");
    });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const initial = (userName ?? userEmail ?? "A").charAt(0).toUpperCase();

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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV.filter((n) => !n.platformOnly || isPlatformAdmin).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
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
              {label}
            </Link>
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
              {userName ?? "Superadmin"}
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
