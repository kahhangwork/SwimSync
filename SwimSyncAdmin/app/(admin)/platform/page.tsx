"use client";

import { useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useNotice } from "./domain/useNotice";
import { usePlatformAccess } from "./domain/usePlatformAccess";
import { useOwnerTransfer } from "./domain/useOwnerTransfer";
import { useProvisioning } from "./domain/useProvisioning";
import { useFamilyStatus } from "./domain/useFamilyStatus";
import { useStudentMove } from "./domain/useStudentMove";
import { useSuspend } from "./domain/useSuspend";
import { useTenants } from "./domain/useTenants";
import { CreditWarningModal } from "./ui/CreditWarningModal";
import { FamilyStatusSection } from "./ui/FamilyStatusSection";
import { NewBusinessForm } from "./ui/NewBusinessForm";
import { NotPlatformAdmin } from "./ui/NotPlatformAdmin";
import { OwnerModal } from "./ui/OwnerModal";
import { StudentMoveSection } from "./ui/StudentMoveSection";
import { SuspendModal } from "./ui/SuspendModal";
import { ProvisionedBanner } from "./ui/ProvisionedBanner";
import { StrandedPanel } from "./ui/StrandedPanel";
import { TenantsTable } from "./ui/TenantsTable";

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
  const { famSearch, setFamSearch, families, famMessage, handleFamilySearch } =
    useFamilyStatus();

  // ── Provisioning a new business ───────────────────────────────────────────

  // The page owns the ONE mount effect; usePlatformAccess holds no effect of its
  // own, so `check()` RETURNS the verdict and loadTenants() chains off the return
  // value rather than racing the state update (playbook §5).
  useEffect(() => {
    (async () => {
      if (await check()) await loadTenants();
    })();
  }, []);







  // All four declared above the two conditional returns below — a hook after a
  // conditional return is a hook that sometimes does not run.


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
<FamilyStatusSection
        famSearch={famSearch}
        setFamSearch={setFamSearch}
        families={families}
        famMessage={famMessage}
        onSearch={handleFamilySearch}
      />
    </div>
  );
}
