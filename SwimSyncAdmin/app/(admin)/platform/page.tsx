"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { formatSgDate, toSgDate } from "@/lib/lessonDates";

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

// One row of platform_tenant_overview(). Every figure is computed in Postgres:
// aggregating these in the browser is silently capped at max_rows = 1000, which
// is correct today and quietly wrong later (see the migration's header).
type TenantRow = {
  tenant_id: string;
  display_name: string;
  join_code: string;
  active_students: number;
  active_classes: number;
  coaches: number;
  /** EVERY coach with no rate, the business's owner included — that is what the
   *  RPC actually counts. Do not render this directly: an owner without a rate
   *  is CORRECT (PRD §7.13), so this number warns about private coaches forever.
   *  `unpaidStaff` below is the figure worth showing. */
  coaches_without_rate: number;
  /** NULL = nothing has EVER been marked. Renders as "never", never as a date. */
  last_attendance_date: string | null;
  sessions_this_month: number;
  sessions_fully_marked: number;
  last_month_billing: "sealed" | "open" | "never run";
  active_families: number;
  /** The business's own admin. NULL when it has none at all. */
  admin_email: string | null;
  /** Whether that admin has EVER signed in. A profiles row only proves an
   *  invite was issued — 'none' means the business is live and joinable with
   *  nobody able to operate it, which is a fault, not a blank. */
  admin_status: "none" | "invited" | "active";
};

/** One coach, with just enough to answer "is this an unpaid STAFF coach?" —
 *  their profile's role (the owner is the tenant admin) and whether any rate
 *  exists at all. The rate's VALUE is deliberately not selected: this asks
 *  whether they are on payroll, not what they earn, and a platform admin has no
 *  business reading another company's pay. */
type StaffRateRow = {
  id: string;
  tenant_id: string;
  /** OBJECT OR ARRAY, and the union is not laziness. PostgREST returns a to-one
   *  embed as an object — verified against the running API 2026-08-01:
   *  `"profiles": {"role": "tenant_admin"}` — but supabase-js infers to-one
   *  embeds as ARRAYS without an explicit hint, and `tsc` rejects the cast that
   *  pretends otherwise. Accepting both and normalising is honest about the
   *  disagreement; casting through `unknown` would just silence the compiler and
   *  leave `roleOf` returning undefined if the shape ever moved. */
  profiles: { role: string } | { role: string }[] | null;
  coach_rates: { id: string }[] | null;
};

/** The coach's profile role, whichever shape the embed arrived in. */
function roleOf(c: StaffRateRow): string | null {
  const p = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
  return p?.role ?? null;
}

/** Bound on the coach scan above. Not a page size — a tripwire: if a real
 *  deployment ever returns this many coaches, the count silently stops being
 *  right and `staffCountWarning` says so on screen. */
const STAFF_SCAN_LIMIT = 2000;

type StrandedParent = {
  parent_id: string;
  full_name: string | null;
  email: string | null;
  joined_at: string;
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
  /** tenant_id → number of NON-OWNER coaches with no rate. See loadTenants(). */
  const [unpaidStaff, setUnpaidStaff] = useState<Map<string, number>>(new Map());
  /** Why the counts above cannot be trusted, or null when they can. An absent
   *  badge and a badge that FAILED TO LOAD look identical on screen, and this
   *  page exists to surface trouble — so the difference has to be said out
   *  loud rather than inferred from a missing amber pill. */
  const [staffCountWarning, setStaffCountWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stranded, setStranded] = useState<StrandedParent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Provisioning a new business ───────────────────────────────────────────
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [newBiz, setNewBiz] = useState({
    businessName: "",
    adminName: "",
    adminEmail: "",
    // Typed twice on purpose: this invite grants tenant_admin to whoever opens
    // it, so a mistyped address is a cross-tenant data exposure, not a bounced
    // email.
    adminEmailConfirm: "",
    isCoach: true,
  });
  const [newBizError, setNewBizError] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<{
    businessName: string;
    joinCode: string;
    adminEmail: string;
    emailSent: boolean;
    inviteLink: string | null;
  } | null>(null);

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

  /**
   * One round trip for the whole overview.
   *
   * This replaced an N+1 loop of client-side counts. Two reasons, and the
   * second is the load-bearing one: the loop issued 2 queries per tenant, and
   * more importantly every client-side aggregate here is capped at
   * max_rows = 1000 SILENTLY — no error, just fewer rows — while a platform
   * admin reads every tenant's data. Postgres has no such ceiling.
   *
   * The RPC gates on is_platform_admin() itself, so an empty result is also the
   * correct answer for anyone else. Errors are surfaced rather than swallowed:
   * an unchecked failure leaves the table empty, which reads as "no businesses"
   * — false reassurance on the one page that exists to show trouble.
   */
  async function loadTenants() {
    const [overview, strandedRes, staffRes] = await Promise.all([
      supabase.rpc("platform_tenant_overview"),
      supabase.rpc("platform_stranded_parents"),
      // WHY THIS IS NOT IN THE RPC. `coaches_without_rate` counts every coach
      // with no rate, the OWNER included — and an owner without a rate is the
      // correct, finished state for a private coach (PRD §7.13), so rendering it
      // would put an amber "unpaid" warning on every private coach's row
      // forever. The figure worth showing is STAFF without a rate: someone who
      // does not own the business and will be paid nothing by payroll.
      //
      // Narrowing it properly means changing the RPC's RETURNS TABLE, which is a
      // DROP/CREATE — a migration, and migrations land alone, one at a time
      // (§7.55). This computes the same answer from three tables the platform
      // admin can already read, so the fix ships without one. When that
      // migration happens, delete this and read the narrowed column.
      supabase
        .from("coaches")
        .select("id, tenant_id, profiles!inner(role), coach_rates(id)")
        .limit(STAFF_SCAN_LIMIT),
    ]);
    if (overview.error) {
      setLoadError(overview.error.message);
      return;
    }
    setLoadError(null);
    setTenants((overview.data ?? []) as TenantRow[]);
    setStranded((strandedRes.data ?? []) as StrandedParent[]);

    // §7.70: a client-side length is silently capped at max_rows, and a capped
    // scan under-counts, which here means a staff coach going unpaid and NOTHING
    // saying so. Coaches are staff, not students, so the cap is far away — but
    // "far away" is exactly what §7.70's 1000-row cap was before it wasn't. Say
    // so out loud rather than quietly returning a wrong number.
    // Checked, not assumed. Left unchecked, a failed scan yields zero counts,
    // every row loses its badge, and the page reads as "nobody is unpaid" —
    // the same false reassurance the overview error above is guarded against.
    const rows = (staffRes.data ?? []) as StaffRateRow[];
    setStaffCountWarning(
      staffRes.error
        ? `could not be checked: ${staffRes.error.message}`
        : rows.length >= STAFF_SCAN_LIMIT
          ? `hit the ${STAFF_SCAN_LIMIT}-coach scan limit, so they may be too low`
          : null
    );

    const counts = new Map<string, number>();
    for (const c of rows) {
      // The owner is a coach whose PROFILE is the tenant admin — that is the
      // whole of the private-coach shape, and it is why no private-vs-school
      // flag is needed (PRD §7.13).
      const isOwner = roleOf(c) === "tenant_admin";
      const hasRate = (c.coach_rates ?? []).length > 0;
      if (isOwner || hasRate) continue;
      counts.set(c.tenant_id, (counts.get(c.tenant_id) ?? 0) + 1);
    }
    setUnpaidStaff(counts);
  }

  /** POST helper that carries the caller's token — the API routes verify it,
   *  and provision_tenant()'s gate is evaluated against THIS user, not the
   *  service role. */
  async function postAs(path: string, body: unknown) {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
      },
      body: JSON.stringify(body),
    });
    return { res, json: await res.json().catch(() => ({})) };
  }

  async function provisionTenant(e: React.FormEvent) {
    e.preventDefault();
    setNewBizError(null);

    if (!newBiz.businessName.trim()) {
      setNewBizError("The business needs a name.");
      return;
    }
    if (!newBiz.adminName.trim()) {
      setNewBizError("The admin needs a name.");
      return;
    }
    if (
      newBiz.adminEmail.trim().toLowerCase() !==
      newBiz.adminEmailConfirm.trim().toLowerCase()
    ) {
      setNewBizError(
        "The two email addresses don't match. This invite grants full admin of the business, so it must go to the right person."
      );
      return;
    }

    setCreating(true);
    const { res, json } = await postAs("/api/provision-tenant", {
      businessName: newBiz.businessName.trim(),
      // `kind` is deliberately not sent. provision_tenant() still defaults the
      // column to 'private'; it is dead data pending a contract migration.
      adminName: newBiz.adminName.trim(),
      adminEmail: newBiz.adminEmail.trim(),
      isCoach: newBiz.isCoach,
    });
    setCreating(false);

    if (!res.ok) {
      setNewBizError(json.error ?? "Could not create the business.");
      return;
    }

    setProvisioned({
      businessName: newBiz.businessName.trim(),
      joinCode: json.joinCode,
      adminEmail: json.adminEmail,
      emailSent: Boolean(json.emailSent),
      inviteLink: json.inviteLink ?? null,
    });
    setShowNew(false);
    setNewBiz({
      businessName: "",
      adminName: "",
      adminEmail: "",
      adminEmailConfirm: "",
      isCoach: true,
    });
    await loadTenants();
  }

  async function resendInvite(tenantId: string) {
    setResending(tenantId);
    setMessage(null);
    const { res, json } = await postAs("/api/resend-invite", { tenantId });
    setResending(null);
    if (!res.ok) {
      setMessage(json.error ?? "Could not resend the invite.");
      return;
    }
    setMessage(
      json.emailSent
        ? `Invite resent to ${json.adminEmail}.`
        : `No email was sent (${json.emailReason}). Copy this link to them: ${json.inviteLink}`
    );
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

  // All four declared above the two conditional returns below — a hook after a
  // conditional return is a hook that sometimes does not run.
  const tenantSort = useTableSort<TenantRow>({
    key: "display_name",
    accessors: {
      // "no admin" first when ascending. A business with no admin is joinable
      // by parents but operable by nobody, which is the fault this page exists
      // to surface — so it sorts to the top, not into alphabetical order.
      admin_status: (t) =>
        t.admin_status === "none" ? 0 : t.admin_status === "invited" ? 1 : 2,
    },
  });
  const visibleTenants = tenantSort.apply(tenants);

  const strandedSort = useTableSort<StrandedParent>({ key: "joined_at", dir: "desc" });
  const visibleStranded = strandedSort.apply(stranded);

  const studentSort = useTableSort<StudentRow>({
    key: "full_name",
    accessors: {
      // The business NAME, which is what the cell shows — the row holds only an
      // id, and sorting by a uuid would look like no sort at all.
      tenant: (s) =>
        tenants.find((t) => t.tenant_id === s.tenant_id)?.display_name ?? null,
      is_active: (s) => !s.is_active,
    },
  });
  const visibleStudents = studentSort.apply(students);

  const familySort = useTableSort<FamilyStatusRow>({
    key: "parent_name",
    accessors: {
      family_active: (f) => !f.family_active,
      children: (f) => f.children.length,
    },
  });
  const visibleFamilies = familySort.apply(families);

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

      {loadError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Could not load the overview: {loadError}
        </div>
      )}

      {/* §7.70: an under-counted scan means a staff coach is going unpaid and
          nothing says so. Silence would be the bug; this is the tripwire. */}
      {staffCountWarning && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          The “unpaid” counts below {staffCountWarning}. They are computed in the
          browser; move them into <code>platform_tenant_overview()</code> before
          relying on them.
        </div>
      )}

      {/* A tenant admin asks "how is MY business doing?"; a platform admin asks
          "WHICH business needs me?" — so this is one row per business with the
          signals that answer that, not a set of platform-wide totals. */}
      {/* The join code is the ONLY route into a business — there is no
          directory — so it is shown once, prominently, at the moment it is
          created. */}
      {provisioned && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4">
          <h3 className="text-sm font-semibold text-green-900">
            {provisioned.businessName} is set up
          </h3>
          <p className="mt-1 text-sm text-green-800">
            Join code:{" "}
            <span className="font-mono font-semibold">
              {provisioned.joinCode}
            </span>{" "}
            — parents enter this in the app to join.
          </p>
          {provisioned.emailSent ? (
            <p className="mt-1 text-sm text-green-800">
              An invite to set a password was sent to{" "}
              <strong>{provisioned.adminEmail}</strong>.
            </p>
          ) : (
            /* The email IS the deliverable here — unlike an invoice email, a
               missing invite means the owner has no way in at all. So this must
               never read as a plain success. */
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                No invite email was sent.
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Send this one-time link to <strong>{provisioned.adminEmail}</strong>{" "}
                yourself — they cannot sign in until they use it:
              </p>
              <code className="mt-2 block break-all rounded bg-white p-2 text-xs text-gray-800">
                {provisioned.inviteLink}
              </code>
            </div>
          )}
          <button
            onClick={() => setProvisioned(null)}
            className="mt-3 text-xs font-medium text-green-800 hover:text-green-900"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Businesses</h2>
            <p className="mt-1 mb-3 text-sm text-gray-600">
              Counts are computed per business in the database, so they never mix
              across tenants and never truncate.
            </p>
          </div>
          <button
            onClick={() => {
              setShowNew(true);
              setNewBizError(null);
            }}
            className="shrink-0 rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600"
          >
            New business
          </button>
        </div>

        {showNew && (
          <form
            onSubmit={provisionTenant}
            className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4"
          >
            <h3 className="text-sm font-semibold text-gray-900">
              Create a business
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              This creates the business and emails its admin a link to set their
              password. The business is live — and its join code works — as soon
              as it is created.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Business name
                </label>
                <input
                  value={newBiz.businessName}
                  onChange={(e) =>
                    setNewBiz({ ...newBiz, businessName: e.target.value })
                  }
                  placeholder="Dolphin Swim Academy"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Admin&apos;s name
                </label>
                <input
                  value={newBiz.adminName}
                  onChange={(e) =>
                    setNewBiz({ ...newBiz, adminName: e.target.value })
                  }
                  placeholder="Marcus Tan"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              {/* THERE IS NO "TYPE" FIELD, and that is deliberate (2026-08-01).
                  This asked "Private coach or Swim school?" and then discarded
                  the answer: nothing in SwimSync branches on it. Worse, it
                  cannot be answered — a one-coach school that pays its owner a
                  wage and a private coach who takes none are IDENTICAL in the
                  data; the difference is intent, which no column can see and no
                  query can derive.
                  The question people actually have is "will anyone here be paid
                  nothing by mistake?", and that needs no type: an owner without
                  a rate is a choice, a STAFF coach without one is the mistake.
                  See PRD §7.13 — the distinction is data, not a rule. */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Admin&apos;s email
                </label>
                <input
                  type="email"
                  value={newBiz.adminEmail}
                  onChange={(e) =>
                    setNewBiz({ ...newBiz, adminEmail: e.target.value })
                  }
                  placeholder="marcus@example.com"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Confirm email
                </label>
                <input
                  type="email"
                  value={newBiz.adminEmailConfirm}
                  onChange={(e) =>
                    setNewBiz({
                      ...newBiz,
                      adminEmailConfirm: e.target.value,
                    })
                  }
                  placeholder="marcus@example.com"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>

            {/* This checkbox is the ONLY thing here that changes what is
                created: it decides whether a coaches row exists. A private coach
                is a tenant of ONE — they administer the business and teach in
                it — and a school's owner may teach too, so this is a real
                question with a real consequence, unlike the "Type" field that
                used to sit above it (removed 2026-08-01: nothing branched on it
                and no query could derive it). */}
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={newBiz.isCoach}
                onChange={(e) =>
                  setNewBiz({ ...newBiz, isCoach: e.target.checked })
                }
                className="rounded border-gray-300"
              />
              This person also teaches (give them a coach account too)
            </label>

            {newBizError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {newBizError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create & invite"}
              </button>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <Table>
          <Thead>
            <Th sort={tenantSort} sortKey="display_name">Name</Th>
            <Th sort={tenantSort} sortKey="admin_status">Admin</Th>
            <Th sort={tenantSort} sortKey="join_code">Join code</Th>
            <Th sort={tenantSort} sortKey="active_families" firstDir="desc">Families</Th>
            <Th sort={tenantSort} sortKey="active_students" firstDir="desc">Students</Th>
            <Th sort={tenantSort} sortKey="active_classes" firstDir="desc">Classes</Th>
            <Th sort={tenantSort} sortKey="coaches" firstDir="desc">Coaches</Th>
            <Th sort={tenantSort} sortKey="last_attendance_date" firstDir="desc">Last attendance</Th>
            <Th sort={tenantSort} sortKey="sessions_this_month" firstDir="desc">Sessions this month</Th>
            <Th sort={tenantSort} sortKey="last_month_billing">Last month&apos;s billing</Th>
          </Thead>
          <Tbody>
            {tenants.length === 0 && !loadError && (
              <Tr>
                <Td colSpan={11}>No businesses.</Td>
              </Tr>
            )}
            {visibleTenants.map((t) => (
              <Tr key={t.tenant_id}>
                <Td>{t.display_name}</Td>
                <Td>
                  {/* A business with NO admin is the bad intermediate state of
                      provisioning: its join code works, so parents can join it,
                      but nobody can operate it. The route compensates by
                      deleting the tenant when an invite fails — this cell is the
                      backstop for any orphan that escapes that. */}
                  {t.admin_status === "none" ? (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                      no admin
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-700">
                        {t.admin_email}
                      </span>
                      {t.admin_status === "invited" ? (
                        <>
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                            invited
                          </span>
                          <button
                            onClick={() => resendInvite(t.tenant_id)}
                            disabled={resending === t.tenant_id}
                            className="text-xs font-medium text-sky-600 hover:text-sky-700 disabled:opacity-50"
                          >
                            {resending === t.tenant_id ? "Sending…" : "Resend"}
                          </button>
                        </>
                      ) : (
                        <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
                          active
                        </span>
                      )}
                    </div>
                  )}
                </Td>
                <Td>
                  <span className="font-mono">{t.join_code}</span>
                </Td>
                <Td>{t.active_families}</Td>
                <Td>{t.active_students}</Td>
                <Td>{t.active_classes}</Td>
                <Td>
                  {t.coaches}
                  {/* Only STAFF are flagged. A coach who owns the business has
                      no rate by design — their income is their parents'
                      invoices (PRD §7.13) — so warning about it would be noise
                      on every private coach's row forever. A coach who does NOT
                      own it and has no rate will be paid nothing by payroll,
                      which is the case worth catching before month end.
                      This read `t.staff_without_rate` until 2026-08-01, a field
                      the RPC has never returned, so the badge was `undefined > 0`
                      and NEVER RENDERED. It now reads the count computed in
                      loadTenants(). */}
                  {(unpaidStaff.get(t.tenant_id) ?? 0) > 0 && (
                    <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      {unpaidStaff.get(t.tenant_id)} unpaid
                    </span>
                  )}
                </Td>
                <Td>
                  {/* NEVER must be visually distinct from a date and from a
                      zero. This is the cell that shows a business has not
                      started using SwimSync at all — or has stopped. */}
                  {t.last_attendance_date ? (
                    formatSgDate(t.last_attendance_date)
                  ) : (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                      never
                    </span>
                  )}
                </Td>
                <Td>
                  {/* Sessions RECORDED, and how many are fully marked. This
                      deliberately does NOT claim to count lessons that were
                      never recorded — a lesson nobody touched has no session
                      row at all (PRD §7.5), and the rule that derives those
                      lives in lessonDates.ts. See the migration header. */}
                  {t.sessions_this_month === 0 ? (
                    <span className="text-gray-400">none recorded</span>
                  ) : (
                    <span
                      className={
                        t.sessions_fully_marked < t.sessions_this_month
                          ? "font-medium text-amber-700"
                          : ""
                      }
                    >
                      {t.sessions_fully_marked}/{t.sessions_this_month} marked
                    </span>
                  )}
                </Td>
                <Td>
                  {/* "never run" and "open" mean different things to an
                      operator and must not collapse into one word. */}
                  {t.last_month_billing === "sealed" && (
                    <span className="text-emerald-700">sealed</span>
                  )}
                  {t.last_month_billing === "open" && (
                    <span className="text-amber-700">open</span>
                  )}
                  {t.last_month_billing === "never run" && (
                    <span className="text-gray-400">never run</span>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      {/* Registered, never entered a join code. They belong to no business, so
          no tenant admin can see them and nothing else surfaces them — and they
          are exactly who the student-move tool below exists for. */}
      {stranded.length > 0 && (
        <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Signed up but not in any business ({stranded.length})
          </h2>
          <p className="mt-1 mb-3 text-sm text-gray-700">
            These parents registered but never entered a join code, so no
            business can see them. They are stuck until someone gives them one.
          </p>
          <Table>
            <Thead>
              <Th sort={strandedSort} sortKey="full_name">Parent</Th>
              <Th sort={strandedSort} sortKey="email">Email</Th>
              <Th sort={strandedSort} sortKey="joined_at" firstDir="desc">Registered</Th>
            </Thead>
            <Tbody>
              {visibleStranded.map((p) => (
                <Tr key={p.parent_id}>
                  <Td>{p.full_name ?? "—"}</Td>
                  <Td>{p.email ?? "—"}</Td>
                  <Td>{formatSgDate(toSgDate(p.joined_at))}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

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
              <Th sort={studentSort} sortKey="full_name">Child</Th>
              <Th sort={studentSort} sortKey="tenant">Currently with</Th>
              <Th sort={studentSort} sortKey="is_active">Active?</Th>
              <Th>Move to</Th>
            </Thead>
            <Tbody>
              {visibleStudents.map((s) => (
                <Tr key={s.id}>
                  <Td>{s.full_name}</Td>
                  <Td>
                    {tenants.find((t) => t.tenant_id === s.tenant_id)?.display_name ??
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
                        .filter((t) => t.tenant_id !== s.tenant_id)
                        .map((t) => (
                          <option key={t.tenant_id} value={t.tenant_id}>
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
              <Th sort={familySort} sortKey="parent_name">Parent</Th>
              <Th sort={familySort} sortKey="tenant_name">Business</Th>
              <Th sort={familySort} sortKey="family_active">Family</Th>
              <Th sort={familySort} sortKey="children">Children there</Th>
            </Thead>
            <Tbody>
              {visibleFamilies.map((f, i) => (
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
