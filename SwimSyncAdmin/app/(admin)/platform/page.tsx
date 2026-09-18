"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { ROW_LIMIT } from "./constants";
import {
  childrenOfParents,
  searchFamilyMemberships,
} from "./dao/platform.repo";
import { useNotice } from "./domain/useNotice";
import { usePlatformAccess } from "./domain/usePlatformAccess";
import { useOwnerTransfer } from "./domain/useOwnerTransfer";
import { useProvisioning } from "./domain/useProvisioning";
import { useStudentMove } from "./domain/useStudentMove";
import { useSuspend } from "./domain/useSuspend";
import { useTenants } from "./domain/useTenants";
import { CreditWarningModal } from "./ui/CreditWarningModal";
import { NewBusinessForm } from "./ui/NewBusinessForm";
import { NotPlatformAdmin } from "./ui/NotPlatformAdmin";
import { OwnerModal } from "./ui/OwnerModal";
import { StudentMoveSection } from "./ui/StudentMoveSection";
import { SuspendModal } from "./ui/SuspendModal";
import { ProvisionedBanner } from "./ui/ProvisionedBanner";
import { StrandedPanel } from "./ui/StrandedPanel";
import { TenantsTable } from "./ui/TenantsTable";
import type {
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
  const {
    search,
    setSearch,
    students,
    covMap,
    moving,
    moveNonce,
    pendingMove,
    handleSearch,
    handleMove,
    doMove,
    cancelMove,
  } = useStudentMove(tenants, setMessage);

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


  // All four declared above the two conditional returns below — a hook after a
  // conditional return is a hook that sometimes does not run.

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

<StudentMoveSection
        tenants={tenants}
        students={students}
        covMap={covMap}
        moving={moving}
        moveNonce={moveNonce}
        search={search}
        setSearch={setSearch}
        message={message}
        onSearch={handleSearch}
        onMove={handleMove}
      />

      {/* ── Advisory: the family's credit does NOT move (Piece 3) ───────────── */}
<CreditWarningModal
        pendingMove={pendingMove}
        onConfirm={doMove}
        onCancel={cancelMove}
      />

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
