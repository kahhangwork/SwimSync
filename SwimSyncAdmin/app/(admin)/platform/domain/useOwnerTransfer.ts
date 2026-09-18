// Changing a business's owner. Stage 7 of docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// ⚠ NO DRIVER OPENS THIS MODAL (grepped 2026-09-18: no verify-*.mjs contains
// "Change owner" or "Set owner"). It is also DORMANT on production — owner
// transfer has no target while every admin is their own owner (HANDOVER §3,
// Wave 5). So the only net here is the hand-check recorded in the Stage 7 commit
// plus these prohibitions. Treat any change as unnetted.
//
// ⚠ ownerModalTenantRef IS A CORRECTNESS GUARD, NOT A STYLE CHOICE. openOwnerModal
// awaits the admin list, then re-reads the ref before writing state: close A,
// open B fast enough, and A's list would land in B's modal. Do NOT replace it
// with state (a re-render would not help — the stale closure is the problem) and
// do NOT drop it because "the RPC refuses it anyway"; the refusal would be
// server-side and baffling rather than impossible.

import { useRef, useState } from "react";
import {
  reassignOwner as reassignOwnerRpc,
  tenantAdmins,
} from "../dao/platform.rpc";
import type { TenantAdminOption, TenantRow } from "../types";

export function useOwnerTransfer(
  setMessage: (m: string | null) => void,
  load: () => Promise<void>
) {
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
  const { error } = await reassignOwnerRpc(ownerModal.tenantId, ownerChoice);
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
  await load();
}

  return {
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
  };
}
