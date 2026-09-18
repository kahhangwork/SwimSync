// Suspending and unsuspending a business — the platform kill switch. Stage 8 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// ⚠ THIS TURNS OFF A LIVE BUSINESS: staff and parents go dark, staff logins are
// banned at the auth layer, and the billing engine skips the tenant. The RPC is
// the boundary; the API route adds the staff ban (parents are NEVER banned —
// WAVE_5_PLAN.md decision 5).
//
// ⚠ ON FAILURE THE MODAL STAYS OPEN, AND THAT IS THE DESIGN. A 500 here means
// the RPC half landed but a ban/unban miss remains, so the button IS the retry
// path — the message names the accounts and says to press again. Closing the
// modal on error would strand the tenant in a half-applied state with no way
// back to the control that fixes it. Do NOT add a close to the error branch.
//
// ⚠ `suspended` is computed at the CLICK, in ui/TenantsTable, from that row's
// own suspended_at. It decides both the API route and every word in the dialog,
// so deriving it anywhere else risks showing "Suspend" over the unsuspend path.

import { useState } from "react";
import { postAs } from "../dao/platform.api";

export function useSuspend(
  setMessage: (m: string | null) => void,
  load: () => Promise<void>
) {
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
  await load();
}

  return { suspendModal, setSuspendModal, suspendBusy, suspendError, toggleSuspend };
}
