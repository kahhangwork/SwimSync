import { Sidebar } from "@/components/Sidebar";
import { AuthGuard } from "@/components/AuthGuard";
import { RequiresTenant } from "@/components/RequiresTenant";
import { PermissionsProvider } from "@/components/PermissionsProvider";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      {/* One load of the signed-in admin's role for the sidebar, the page gate
          and the pages (ROLES_PERMISSIONS_PLAN.md §5.5). */}
      <PermissionsProvider>
      {/* Below 800px the sidebar becomes a top bar + drawer and the page
          stacks under it (DESIGN.md → Layout; UI restyle 1.6). */}
      <div className="flex h-screen flex-col overflow-hidden min-[800px]:flex-row">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 min-[800px]:p-8">
          {/* Applied here rather than per page so a route cannot be added
              without a gate. It reads each route's audience from NAV in
              lib/adminNav.ts — the same declaration the sidebar renders from —
              and unknown paths fail closed. See RequiresTenant for why it
              unmounts rather than overlays. */}
          <RequiresTenant>{children}</RequiresTenant>
        </main>
      </div>
      </PermissionsProvider>
    </AuthGuard>
  );
}
