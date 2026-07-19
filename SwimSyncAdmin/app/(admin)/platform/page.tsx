"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";

/**
 * Platform admin — cross-tenant operations, for SwimSync itself.
 *
 * Distinct from a TENANT admin, who administers one business and must never see
 * another's data. The platform admin exists for support: seeing which
 * businesses are on the platform, and fixing a student who ended up in the
 * wrong one (the realistic error — a parent entering the wrong join code).
 *
 * NOT a "view as tenant" impersonation mode. That would mean scoping every
 * admin page to a chosen tenant rather than the caller's own, which is a much
 * larger change than the rescue capability this page is for. Deliberately
 * out of scope.
 *
 * Every write here goes through reassign_student_tenant(), which enforces
 * platform-admin-only ITSELF: this page's own gate is a UX affordance, not the
 * security boundary.
 */

type TenantRow = {
  id: string;
  display_name: string;
  kind: string;
  join_code: string;
  students: number;
  classes: number;
};

type StudentRow = {
  id: string;
  full_name: string;
  tenant_id: string;
  assignment_status: string;
  is_active: boolean;
};

type FamilyStatusRow = {
  parent_name: string;
  email: string;
  tenant_name: string;
  family_active: boolean;
  children: { full_name: string; is_active: boolean }[];
};

export default function PlatformPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setAllowed(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .maybeSingle();

      const ok = profile?.role === "platform_admin";
      setAllowed(ok);
      if (ok) await loadTenants();
    })();
  }, []);

  async function loadTenants() {
    // RLS lets only the platform admin read every tenant, so this returning
    // more than one is itself a signal the role is right.
    const { data } = await supabase
      .from("tenants")
      .select("id, display_name, kind, join_code")
      .order("display_name");

    const rows: TenantRow[] = [];
    for (const t of data ?? []) {
      const [{ count: students }, { count: classes }] = await Promise.all([
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", t.id),
        supabase
          .from("classes")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", t.id),
      ]);
      rows.push({
        ...(t as Omit<TenantRow, "students" | "classes">),
        students: students ?? 0,
        classes: classes ?? 0,
      });
    }
    setTenants(rows);
  }

  const [famSearch, setFamSearch] = useState("");
  const [families, setFamilies] = useState<FamilyStatusRow[]>([]);
  const [famMessage, setFamMessage] = useState<string | null>(null);

  // Platform-admin view of a family ACROSS businesses — the one place that
  // exists. A tenant admin can only ever see their own side of this.
  //
  // Deliberately shows activity but NOT assigned/unassigned: which class a
  // child is in is the business's operational concern, and putting it here
  // would invite the platform admin to reason about it.
  async function handleFamilySearch() {
    setFamMessage(null);
    if (!famSearch.trim()) {
      setFamilies([]);
      return;
    }
    const { data } = await supabase
      .from("parent_tenants")
      .select(
        "parent_id, tenant_id, is_active, tenants(display_name), parents(profile_id, profiles(full_name, email))"
      );

    const rows = (data ?? []) as any[];
    const q = famSearch.trim().toLowerCase();
    const matching = rows.filter((r) => {
      const p = r.parents?.profiles ?? {};
      return (
        (p.full_name ?? "").toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q)
      );
    });

    const { data: kids } = await supabase
      .from("parent_students")
      .select("parent_id, students(full_name, is_active, tenant_id)")
      .in(
        "parent_id",
        matching.length ? matching.map((r) => r.parent_id) : ["00000000-0000-0000-0000-000000000000"]
      );

    setFamilies(
      matching.map((r) => ({
        parent_name: r.parents?.profiles?.full_name ?? "—",
        email: r.parents?.profiles?.email ?? "—",
        tenant_name: r.tenants?.display_name ?? "—",
        family_active: r.is_active,
        children: (kids ?? [])
          .filter((k: any) => k.parent_id === r.parent_id && k.students?.tenant_id === r.tenant_id)
          .map((k: any) => ({ full_name: k.students.full_name, is_active: k.students.is_active })),
      }))
    );
    if (matching.length === 0) setFamMessage("No families matched.");
  }

  async function handleSearch() {
    setMessage(null);
    if (!search.trim()) {
      setStudents([]);
      return;
    }
    const { data } = await supabase
      .from("students")
      .select("id, full_name, tenant_id, assignment_status, is_active")
      .ilike("full_name", `%${search.trim()}%`)
      .limit(25);
    setStudents((data ?? []) as StudentRow[]);
  }

  async function handleMove(studentId: string, tenantId: string) {
    setMoving(studentId);
    setMessage(null);
    const { error } = await supabase.rpc("reassign_student_tenant", {
      p_student_id: studentId,
      p_tenant_id: tenantId,
    });
    setMoving(null);
    if (error) {
      setMessage(`Could not move: ${error.message}`);
      return;
    }
    // Refresh FIRST, then set the message: handleSearch() clears it on entry,
    // so setting it beforehand meant the confirmation was wiped by its own
    // refresh and the move looked like it had done nothing.
    await handleSearch();
    setMessage(
      "Moved. Any active class enrolment was closed — the new business needs to assign them a class."
    );
  }

  if (allowed === null) return <div className="p-6 text-gray-500">Loading…</div>;

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Platform" subtitle="Cross-tenant operations" />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-600">
          This page is for the SwimSync platform admin. Your account
          administers a single business, which is what every other page shows.
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Platform"
        subtitle="Every business on SwimSync — support and cross-tenant fixes"
      />

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Businesses</h2>
        <Table>
          <Thead>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Join code</Th>
            <Th>Students</Th>
            <Th>Classes</Th>
          </Thead>
          <Tbody>
            {tenants.map((t) => (
              <Tr key={t.id}>
                <Td>{t.display_name}</Td>
                <Td>{t.kind}</Td>
                <Td>
                  <span className="font-mono">{t.join_code}</span>
                </Td>
                <Td>{t.students}</Td>
                <Td>{t.classes}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Move a student to another business
        </h2>
        <p className="mt-1 mb-3 text-sm text-gray-600">
          For when a parent entered the wrong join code. Moving closes any active
          class enrolment — attendance and billing history stay with the business
          that recorded them.
        </p>

        <div className="mb-4 flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search a child's name"
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <button
            onClick={handleSearch}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600"
          >
            Search
          </button>
        </div>

        {message && (
          <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {message}
          </div>
        )}

        {students.length > 0 && (
          <Table>
            <Thead>
              <Th>Child</Th>
              <Th>Currently with</Th>
              <Th>Active?</Th>
              <Th>Move to</Th>
            </Thead>
            <Tbody>
              {students.map((s) => (
                <Tr key={s.id}>
                  <Td>{s.full_name}</Td>
                  <Td>
                    {tenants.find((t) => t.id === s.tenant_id)?.display_name ??
                      "—"}
                  </Td>
                  <Td>{s.is_active ? "Active" : "Inactive"}</Td>
                  <Td>
                    <select
                      defaultValue=""
                      disabled={moving === s.id}
                      onChange={(e) =>
                        e.target.value && handleMove(s.id, e.target.value)
                      }
                      className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    >
                      <option value="">
                        {moving === s.id ? "Moving…" : "Choose…"}
                      </option>
                      {tenants
                        .filter((t) => t.id !== s.tenant_id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.display_name}
                          </option>
                        ))}
                    </select>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>

      {/* ── Family status across businesses ──────────────────────────────────
          Read-only on purpose. Whether a family is a customer of a business is
          THAT business's call, so this shows the answer without offering to
          change it. There is no login-blocking control here either: that is a
          platform power over an ACCOUNT and is filed separately. */}
      <div className="mt-8 rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Family status</h2>
        <p className="mb-4 text-sm text-gray-500">
          Where a family stands at each business they deal with. Read-only —
          activity is the business&apos;s decision, not the platform&apos;s.
        </p>

        <div className="mb-4 flex gap-2">
          <input
            value={famSearch}
            onChange={(e) => setFamSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFamilySearch()}
            placeholder="Search a parent's name or email"
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <button
            onClick={handleFamilySearch}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600"
          >
            Search
          </button>
        </div>

        {famMessage && (
          <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {famMessage}
          </div>
        )}

        {families.length > 0 && (
          <Table>
            <Thead>
              <Th>Parent</Th>
              <Th>Business</Th>
              <Th>Family</Th>
              <Th>Children there</Th>
            </Thead>
            <Tbody>
              {families.map((f, i) => (
                <Tr key={`${f.email}:${f.tenant_name}:${i}`}>
                  <Td>
                    <div className="font-medium text-gray-900">{f.parent_name}</div>
                    <div className="text-xs text-gray-500">{f.email}</div>
                  </Td>
                  <Td>{f.tenant_name}</Td>
                  <Td>{f.family_active ? "Active" : "Inactive"}</Td>
                  <Td>
                    {f.children.length === 0 ? (
                      <span className="text-gray-400">none</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {f.children.map((c) => (
                          <span
                            key={c.full_name}
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              c.is_active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-gray-100 text-gray-500 line-through"
                            }`}
                          >
                            {c.full_name}
                          </span>
                        ))}
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
