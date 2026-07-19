import { Sidebar } from "@/components/Sidebar";
import { AuthGuard } from "@/components/AuthGuard";
import { RequiresTenant } from "@/components/RequiresTenant";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          {/* Applied here rather than per page so a route cannot be added
              without a gate. It reads each route's audience from NAV in
              lib/adminNav.ts — the same declaration the sidebar renders from —
              and unknown paths fail closed. See RequiresTenant for why it
              unmounts rather than overlays. */}
          <RequiresTenant>{children}</RequiresTenant>
        </main>
      </div>
    </AuthGuard>
  );
}
