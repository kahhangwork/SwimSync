"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Modal } from "@/components/Modal";
import { formatSgDate, toSgDate } from "@/lib/lessonDates";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { PackageChip } from "@/components/PackageChip";
import { totalFamilyCredit } from "@/lib/moveStudentWarning";
import { ROW_LIMIT } from "./constants";
import {
  childrenOfParents,
  currentUser,
  familyCreditAt,
  parentLinksForStudent,
  profileRole,
  searchFamilyMemberships,
  searchStudents,
} from "./dao/platform.repo";
import {
  loadOverview,
  reassignOwner as rpcReassignOwner,
  reassignStudentTenant,
  studentPackageCoverage,
  tenantAdmins,
} from "./dao/platform.rpc";
import { postAs } from "./dao/platform.api";
import type {
  TenantRow,
  TenantAdminOption,
  StrandedParent,
  StudentRow,
  FamilyStatusRow,
} from "./types";

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

export default function PlatformPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );
  const [moving, setMoving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The advisory credit warning before a cross-business move (Piece 3). Set when
  // the family holds credit at the OLD business (or that could not be checked);
  // confirming calls doMove(). `moveNonce` remounts the per-row picker so it
  // resets to "Choose…" after a move or a cancel (it is uncontrolled).
  const [pendingMove, setPendingMove] = useState<{
    studentId: string;
    tenantId: string;
    studentName: string;
    oldTenantName: string;
    credit: number;
    checkFailed: boolean;
  } | null>(null);
  const [moveNonce, setMoveNonce] = useState(0);
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
      const { data: auth } = await currentUser();
      if (!auth.user) {
        setAllowed(false);
        return;
      }
      const { data: profile } = await profileRole(auth.user.id);

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
    const [overview, strandedRes] = await loadOverview();
    if (overview.error) {
      setLoadError(overview.error.message);
      return;
    }
    setLoadError(null);
    setTenants((overview.data ?? []) as TenantRow[]);
    setStranded((strandedRes.data ?? []) as StrandedParent[]);
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
      // No `kind`: the column is gone (20260804000100). A business's shape is
      // derived from its data, never declared (PRD §4.4).
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

  // ── Changing a business's owner ───────────────────────────────────────────
  // Platform-admin only, by decision (WAVE_5_PLAN.md decision 2): the tenant
  // owner has no transfer button anywhere. This one action covers both the
  // handover and the lost-owner case — a tenant whose Admin cell reads
  // "no admin" can still have live co-admins to promote, which is exactly the
  // frozen state the RPC exists to fix.
  const [ownerModal, setOwnerModal] = useState<{
    tenantId: string;
    tenantName: string;
    currentEmail: string | null;
  } | null>(null);
  const [ownerAdmins, setOwnerAdmins] = useState<TenantAdminOption[]>([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerChoice, setOwnerChoice] = useState("");
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);

  // Which tenant the OPEN modal belongs to — read after the await below.
  const ownerModalTenantRef = useRef<string | null>(null);

  function closeOwnerModal() {
    ownerModalTenantRef.current = null;
    setOwnerModal(null);
  }

  async function openOwnerModal(t: TenantRow) {
    ownerModalTenantRef.current = t.tenant_id;
    setOwnerModal({
      tenantId: t.tenant_id,
      tenantName: t.display_name,
      currentEmail: t.admin_email,
    });
    setOwnerAdmins([]);
    setOwnerChoice("");
    setOwnerError(null);
    setOwnerLoading(true);
    const { data, error } = await tenantAdmins(t.tenant_id);
    // Guard against a stale response: close A, open B fast enough and A's
    // list would land in B's modal. Submitting would be server-refused anyway
    // ("must be an admin of that business") — this just prevents the baffling
    // refusal from ever being reachable.
    if (ownerModalTenantRef.current !== t.tenant_id) return;
    setOwnerLoading(false);
    if (error) {
      setOwnerError(error.message);
      return;
    }
    setOwnerAdmins((data ?? []) as TenantAdminOption[]);
  }

  async function reassignOwner() {
    if (!ownerModal || !ownerChoice) return;
    setOwnerSaving(true);
    setOwnerError(null);
    const { error } = await rpcReassignOwner(ownerModal.tenantId, ownerChoice);
    setOwnerSaving(false);
    if (error) {
      // The RPC's refusals (deactivated target, non-admin, …) surface verbatim
      // — they are written for humans.
      setOwnerError(error.message);
      return;
    }
    const chosen = ownerAdmins.find((a) => a.profile_id === ownerChoice);
    setMessage(
      `${ownerModal.tenantName} is now owned by ${chosen?.email ?? "the selected admin"}.`
    );
    closeOwnerModal();
    await loadTenants();
  }

  // ── Suspending / unsuspending a business ──────────────────────────────────
  // Platform-admin only. The RPC is the boundary; the API route adds the
  // staff auth-layer ban (parents are never banned — decision 5). The confirm
  // dialog carries accepted consequence 1's exact shape: the app goes dark,
  // already-sent invoice links keep working (decision 8).
  const [suspendModal, setSuspendModal] = useState<{
    tenantId: string;
    tenantName: string;
    suspended: boolean;
  } | null>(null);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  async function toggleSuspend() {
    if (!suspendModal) return;
    setSuspendBusy(true);
    setSuspendError(null);
    const path = suspendModal.suspended
      ? "/api/unsuspend-tenant"
      : "/api/suspend-tenant";
    const { res, json } = await postAs(path, {
      tenantId: suspendModal.tenantId,
    });
    setSuspendBusy(false);
    if (!res.ok) {
      // A 500 here means the RPC half landed but a ban/unban miss remains —
      // the message names the accounts and says to press again. Keep the
      // modal open: the button IS the retry path.
      setSuspendError(json.error ?? "Something went wrong — press again.");
      return;
    }
    setMessage(
      suspendModal.suspended
        ? `${suspendModal.tenantName} is operating again — staff logins restored (individually disabled staff stay disabled).`
        : `${suspendModal.tenantName} is suspended — its app is dark and staff logins are blocked.`
    );
    setSuspendModal(null);
    await loadTenants();
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
    const term = famSearch.trim();
    if (!term) {
      setFamilies([]);
      return;
    }
    // ⚠ RISK 3 — this used to fetch EVERY parent_tenants row and filter in JS,
    // which silently searched only the first 1000 memberships. The term is now
    // pushed into the DB: match the parent's name OR email through the profiles
    // embed. BOTH embeds are !inner — over a plain (left) embed the .or() would
    // not restrict the memberships, returning every one with a null embed (the
    // silent wrong answer). The term is sanitised for the .or() grammar by
    // orIlike (lib/tableSearch), so a comma or brackets in a name is data, never
    // structure, and can never change the query.
    const { data, error } = await searchFamilyMemberships(term);

    if (error) {
      setFamilies([]);
      setFamMessage(`Could not search families: ${error.message}`);
      return;
    }
    const matching = (data ?? []) as any[];

    // Bounded by the matched memberships (the .in list), so this second query is
    // not a fresh unbounded fetch. The sentinel keeps `.in([])` from matching
    // everything when there are no matches.
    const { data: kids, error: kidsErr } = await childrenOfParents(
      matching.map((r) => r.parent_id)
    );
    // Surfaced, not swallowed: a failed children read would otherwise render
    // every matched family as "none" — a wrong answer that looks like data.
    if (kidsErr) {
      setFamMessage(
        `Found ${matching.length} famil${matching.length === 1 ? "y" : "ies"}, but their children could not be loaded — try again.`,
      );
    }

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
    else if (matching.length >= ROW_LIMIT)
      setFamMessage(`Showing the first ${ROW_LIMIT} matches — refine your search.`);
  }

  async function handleSearch() {
    setMessage(null);
    if (!search.trim()) {
      setStudents([]);
      return;
    }
    const { data } = await searchStudents(search);
    setStudents((data ?? []) as StudentRow[]);
    // Payment-method chips. Under a platform admin the RPC returns EVERY
    // tenant's rows, each carrying its tenant_id — keyed per student here, so
    // a cross-tenant mixup is structurally impossible. Fire-and-forget.
    studentPackageCoverage().then(({ data: cov }) =>
      setCovMap(coverageByStudent(cov ?? []))
    );
  }

  // Advisory gate: credit never crosses businesses (PRD §5.6), so a family with
  // credit at the OLD business would strand it. Check the balance FIRST and
  // prompt; a zero balance (the common case) moves straight through.
  async function handleMove(studentId: string, tenantId: string) {
    // Disable this row's picker for the whole credit check, so a second
    // selection cannot overwrite the pending move mid-flight.
    setMoving(studentId);
    const student = students.find((s) => s.id === studentId);
    const oldTenantId = student?.tenant_id ?? null;
    const oldTenantName =
      tenants.find((t) => t.tenant_id === oldTenantId)?.display_name ??
      "the old business";

    let credit = 0;
    let checkFailed = false;
    if (oldTenantId) {
      // ⚠ RISK (fable): sum EVERY linked parent's credit, not just one — a child
      // can have two parents. The balance table is platform-admin readable.
      const { data: links, error: linkErr } = await parentLinksForStudent(studentId);
      // A failed link read must fail TOWARD prompting: skipping it silently
      // would drop the warning in exactly the case we cannot verify.
      if (linkErr) checkFailed = true;
      const parentIds = (links ?? []).map((l: any) => l.parent_id);
      if (!checkFailed && parentIds.length > 0) {
        const { data: bal, error: balErr } = await familyCreditAt(
          oldTenantId,
          parentIds
        );
        if (balErr) checkFailed = true;
        else credit = totalFamilyCredit((bal ?? []) as any[]);
      }
    }

    setMoving(null);
    // Warn when there IS credit, or when the check could not run (fail toward
    // prompting — an advisory that silently skips is worse than one shown twice).
    if (credit > 0 || checkFailed) {
      setPendingMove({
        studentId,
        tenantId,
        studentName: student?.full_name ?? "this child",
        oldTenantName,
        credit,
        checkFailed,
      });
      // The picker keeps its chosen value; the dialog owns the next step, and
      // both its buttons bump moveNonce to reset it.
      return;
    }
    await doMove(studentId, tenantId);
  }

  async function doMove(studentId: string, tenantId: string) {
    setPendingMove(null);
    setMoving(studentId);
    setMessage(null);
    const { error } = await reassignStudentTenant(studentId, tenantId);
    setMoving(null);
    setMoveNonce((n) => n + 1); // reset the per-row picker
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
                <Td>
                  <div className="flex items-center gap-2">
                    <span>{t.display_name}</span>
                    {t.suspended_at && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                        suspended
                      </span>
                    )}
                    <button
                      onClick={() =>
                        setSuspendModal({
                          tenantId: t.tenant_id,
                          tenantName: t.display_name,
                          suspended: t.suspended_at !== null,
                        })
                      }
                      className="text-xs font-medium text-sky-600 hover:text-sky-700"
                    >
                      {t.suspended_at ? "Unsuspend" : "Suspend"}
                    </button>
                  </div>
                </Td>
                <Td>
                  {/* A business with NO admin is the bad intermediate state of
                      provisioning: its join code works, so parents can join it,
                      but nobody can operate it. The route compensates by
                      deleting the tenant when an invite fails — this cell is the
                      backstop for any orphan that escapes that. */}
                  {t.admin_status === "none" ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                        no admin
                      </span>
                      {/* The LOST-OWNER case: "no admin" means no OWNER — the
                          business may still hold live co-admins to promote,
                          and this button is the only remedy that isn't SQL. */}
                      <button
                        onClick={() => openOwnerModal(t)}
                        className="text-xs font-medium text-sky-600 hover:text-sky-700"
                      >
                        Set owner
                      </button>
                    </div>
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
                      <button
                        onClick={() => openOwnerModal(t)}
                        className="text-xs font-medium text-sky-600 hover:text-sky-700"
                      >
                        Change owner
                      </button>
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
                      The owner is excluded IN SQL — see the type above for why
                      the browser scan that briefly replaced this column was
                      based on a backwards reading of the RPC. */}
                  {t.staff_without_rate > 0 && (
                    <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      {t.staff_without_rate} unpaid
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

        <Modal
          title={`Change owner — ${ownerModal?.tenantName ?? ""}`}
          open={ownerModal !== null}
          onClose={closeOwnerModal}
        >
          <p className="mb-3 text-sm text-gray-700">
            The owner is the one account that can manage this business&apos;s
            admins. Ownership moves immediately;{" "}
            {ownerModal?.currentEmail ? (
              <>
                <span className="font-medium">{ownerModal.currentEmail}</span>{" "}
                stays on as a co-admin.
              </>
            ) : (
              <>this business currently has no owner at all.</>
            )}
          </p>
          {ownerLoading ? (
            <p className="mb-4 text-sm text-gray-400">Loading admins…</p>
          ) : ownerAdmins.length === 0 && !ownerError ? (
            <p className="text-sm text-gray-500">
              No admin accounts to choose from — this business has no
              co-admins. Invite one first.
            </p>
          ) : (
            <select
              value={ownerChoice}
              onChange={(e) => setOwnerChoice(e.target.value)}
              className="mb-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Choose the new owner…</option>
              {ownerAdmins.map((a) => (
                <option
                  key={a.profile_id}
                  value={a.profile_id}
                  disabled={a.is_owner || a.is_disabled}
                >
                  {a.full_name || a.email}
                  {a.is_owner ? " — current owner" : ""}
                  {a.is_disabled ? " — deactivated" : ""}
                </option>
              ))}
            </select>
          )}
          {ownerError && (
            <p className="mb-3 text-sm font-medium text-red-600">{ownerError}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={reassignOwner}
              disabled={!ownerChoice || ownerSaving}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
            >
              {ownerSaving
                ? "Transferring…"
                : `Make ${
                    ownerAdmins.find((a) => a.profile_id === ownerChoice)
                      ?.full_name || "them"
                  } the owner`}
            </button>
            <button
              onClick={closeOwnerModal}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
            >
              Cancel
            </button>
          </div>
        </Modal>

        <Modal
          title={
            suspendModal?.suspended
              ? `Unsuspend ${suspendModal?.tenantName ?? ""}?`
              : `Suspend ${suspendModal?.tenantName ?? ""}?`
          }
          open={suspendModal !== null}
          onClose={() => setSuspendModal(null)}
        >
          {suspendModal?.suspended ? (
            <p className="mb-4 text-sm text-gray-700">
              Staff logins come back and the app lights up again for this
              business&apos;s families. Staff who were individually disabled
              before the suspension stay disabled.
            </p>
          ) : (
            /* Accepted consequence 1's exact shape (WAVE_5_PLAN.md): the
               outstanding-receivables position is the owner's problem BEFORE
               suspension, and the dialog says so out loud. */
            <p className="mb-4 text-sm text-gray-700">
              The app goes dark for this business&apos;s staff and families:
              staff logins are blocked, parents stop seeing this
              business&apos;s data (a family with another business keeps that
              one), and no new invoices are generated.{" "}
              <span className="font-medium">
                Already-sent invoice links keep working
              </span>{" "}
              — settling outstanding invoices before suspending is the
              owner&apos;s responsibility.
            </p>
          )}
          {suspendError && (
            <p className="mb-3 text-sm font-medium text-red-600">
              {suspendError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={toggleSuspend}
              disabled={suspendBusy}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                suspendModal?.suspended
                  ? "bg-sky-500 hover:bg-sky-600"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {suspendBusy
                ? suspendModal?.suspended
                  ? "Unsuspending…"
                  : "Suspending…"
                : suspendModal?.suspended
                  ? "Unsuspend this business"
                  : "Suspend this business"}
            </button>
            <button
              onClick={() => setSuspendModal(null)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
            >
              Cancel
            </button>
          </div>
        </Modal>
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
                  <Td>
                    {s.full_name}
                    <span className="ml-1.5">
                      <PackageChip coverage={covMap.get(s.id)} />
                    </span>
                  </Td>
                  <Td>
                    {tenants.find((t) => t.tenant_id === s.tenant_id)?.display_name ??
                      "—"}
                  </Td>
                  <Td>{s.is_active ? "Active" : "Inactive"}</Td>
                  <Td>
                    <select
                      key={`move-${s.id}-${moveNonce}`}
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

      {/* ── Advisory: the family's credit does NOT move (Piece 3) ───────────── */}
      <Modal
        title="Credit stays with the old business"
        open={pendingMove !== null}
        onClose={() => {
          setPendingMove(null);
          setMoveNonce((n) => n + 1); // reset the picker on cancel too
        }}
      >
        {pendingMove && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              {pendingMove.checkFailed ? (
                <>
                  Couldn&apos;t check whether{" "}
                  <strong>{pendingMove.studentName}</strong>&apos;s family holds
                  credit at <strong>{pendingMove.oldTenantName}</strong>. Credit
                  never moves between businesses (PRD §5.6), so any they have
                  there would become unspendable after the move.
                </>
              ) : (
                <>
                  <strong>{pendingMove.studentName}</strong>&apos;s family holds{" "}
                  <strong>S${pendingMove.credit.toFixed(2)}</strong> in credit at{" "}
                  <strong>{pendingMove.oldTenantName}</strong>. Credit never moves
                  between businesses (PRD §5.6), so it will become{" "}
                  <strong>unspendable</strong> once the child is moved. Settle or
                  spend it first if you can.
                </>
              )}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => doMove(pendingMove.studentId, pendingMove.tenantId)}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Move anyway
              </button>
              <button
                onClick={() => {
                  setPendingMove(null);
                  setMoveNonce((n) => n + 1);
                }}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

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
