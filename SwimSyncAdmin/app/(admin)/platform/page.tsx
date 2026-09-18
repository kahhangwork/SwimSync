"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { PackageChip } from "@/components/PackageChip";
import { totalFamilyCredit } from "@/lib/moveStudentWarning";
import { ROW_LIMIT } from "./constants";
import {
  childrenOfParents,
  familyCreditAt,
  parentLinksForStudent,
  searchFamilyMemberships,
  searchStudents,
} from "./dao/platform.repo";
import {
  reassignStudentTenant,
  studentPackageCoverage,
} from "./dao/platform.rpc";
import { useNotice } from "./domain/useNotice";
import { usePlatformAccess } from "./domain/usePlatformAccess";
import { useOwnerTransfer } from "./domain/useOwnerTransfer";
import { useProvisioning } from "./domain/useProvisioning";
import { useSuspend } from "./domain/useSuspend";
import { useTenants } from "./domain/useTenants";
import { NewBusinessForm } from "./ui/NewBusinessForm";
import { NotPlatformAdmin } from "./ui/NotPlatformAdmin";
import { OwnerModal } from "./ui/OwnerModal";
import { SuspendModal } from "./ui/SuspendModal";
import { ProvisionedBanner } from "./ui/ProvisionedBanner";
import { StrandedPanel } from "./ui/StrandedPanel";
import { TenantsTable } from "./ui/TenantsTable";
import type {
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
  const { allowed, check } = usePlatformAccess();
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );
  const [moving, setMoving] = useState<string | null>(null);
  const { message, setMessage } = useNotice();
  const { tenants, stranded, loadError, load: loadTenants } = useTenants();
  const {
    showNew,
    setShowNew,
    creating,
    resending,
    newBiz,
    setNewBiz,
    newBizError,
    setNewBizError,
    provisioned,
    setProvisioned,
    provisionTenant,
    resendInvite,
  } = useProvisioning(loadTenants, setMessage);
  const {
    ownerModal,
    ownerAdmins,
    ownerLoading,
    ownerChoice,
    setOwnerChoice,
    ownerSaving,
    ownerError,
    openOwnerModal,
    closeOwnerModal,
    reassignOwner,
  } = useOwnerTransfer(setMessage, loadTenants);
  const {
    suspendModal,
    setSuspendModal,
    suspendBusy,
    suspendError,
    toggleSuspend,
  } = useSuspend(setMessage, loadTenants);
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

  // ── Provisioning a new business ───────────────────────────────────────────

  // The page owns the ONE mount effect; usePlatformAccess holds no effect of its
  // own, so `check()` RETURNS the verdict and loadTenants() chains off the return
  // value rather than racing the state update (playbook §5).
  useEffect(() => {
    (async () => {
      if (await check()) await loadTenants();
    })();
  }, []);




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

  if (!allowed) return <NotPlatformAdmin />;

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
        <ProvisionedBanner
          provisioned={provisioned}
          onDismiss={() => setProvisioned(null)}
        />
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
          <NewBusinessForm
            newBiz={newBiz}
            setNewBiz={setNewBiz}
            newBizError={newBizError}
            creating={creating}
            onSubmit={provisionTenant}
            onCancel={() => setShowNew(false)}
          />
        )}
<TenantsTable
          tenants={tenants}
          loadError={loadError}
          resending={resending}
          onResend={resendInvite}
          onChangeOwner={openOwnerModal}
          onSuspend={setSuspendModal}
        />

<OwnerModal
          ownerModal={ownerModal}
          ownerAdmins={ownerAdmins}
          ownerLoading={ownerLoading}
          ownerChoice={ownerChoice}
          ownerSaving={ownerSaving}
          ownerError={ownerError}
          onChoose={setOwnerChoice}
          onConfirm={reassignOwner}
          onClose={closeOwnerModal}
        />

<SuspendModal
          suspendModal={suspendModal}
          suspendBusy={suspendBusy}
          suspendError={suspendError}
          onConfirm={toggleSuspend}
          onClose={() => setSuspendModal(null)}
        />
      </div>

      {/* Registered, never entered a join code. They belong to no business, so
          no tenant admin can see them and nothing else surfaces them — and they
          are exactly who the student-move tool below exists for. */}
{stranded.length > 0 && <StrandedPanel stranded={stranded} />}

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
