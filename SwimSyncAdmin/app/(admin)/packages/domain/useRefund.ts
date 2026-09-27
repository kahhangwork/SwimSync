// Record / reverse a package refund (PACKAGE_REVENUE_REFUNDS_PLAN.md U2,
// migration 20260928000200). busy/reload come from usePackageList (⚠ RISK 2).
//
// The RPCs are the guard — the cap (what the family paid), the dates (today or
// earlier in SGT, not before payment, never a closed month), one live refund —
// so this hook only mirrors the obvious checks and shows the server's own
// sentence when it refuses. It may orchestrate the RPCs; it never replaces one.

import { useState } from "react";
import { todayInSg } from "@/lib/lessonDates";
import { can } from "@/lib/permissions";
import { usePermissions } from "@/components/PermissionsProvider";
import * as rpc from "../dao/packages.rpc";
import type { LiveRefund, Purchase } from "../types";

type Shared = {
  setBusy: (b: boolean) => void;
  reload: () => void;
};

export function useRefund({ setBusy, reload }: Shared) {
  // The controls need packages:edit, KNOWN — while permissions load (or fail)
  // canEdit is false, so nothing offers a refund the server would refuse
  // (⚠ RISK 6). The RPC is still the boundary.
  const { status: permsStatus, perms } = usePermissions();
  const canEdit = permsStatus === "ready" && can(perms, "packages", "edit");
  const [refunding, setRefunding] = useState<Purchase | null>(null);
  const [amount, setAmount] = useState("");
  const [refundedOn, setRefundedOn] = useState("");
  const [note, setNote] = useState("");
  const [refundError, setRefundError] = useState<string | null>(null);
  const [reversing, setReversing] = useState<{ purchase: Purchase; refund: LiveRefund } | null>(null);
  const [reverseError, setReverseError] = useState<string | null>(null);

  function openRefund(p: Purchase) {
    // No amount is suggested (decided 2026-09-27): the admin types what they sent.
    setAmount("");
    setRefundedOn(todayInSg());
    setNote("");
    setRefundError(null);
    setRefunding(p);
  }

  async function submitRefund() {
    if (!refunding) return;
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      setRefundError("Enter the amount you refunded.");
      return;
    }
    if (!refundedOn) {
      setRefundError("Choose the date the refund was paid.");
      return;
    }
    setBusy(true);
    setRefundError(null);
    const { error } = await rpc.recordPackageRefund(refunding.id, value, refundedOn, note.trim());
    setBusy(false);
    if (error) {
      // The RPC's refusal is written for the admin; keep the modal open on it.
      setRefundError(error.message || "Could not record that refund.");
      return;
    }
    setRefunding(null);
    reload();
  }

  function openReverse(purchase: Purchase, refund: LiveRefund) {
    setReverseError(null);
    setReversing({ purchase, refund });
  }

  async function submitReverse() {
    if (!reversing) return;
    setBusy(true);
    setReverseError(null);
    const { error } = await rpc.reversePackageRefund(reversing.refund.id);
    setBusy(false);
    if (error) {
      setReverseError(error.message || "Could not reverse that refund.");
      return;
    }
    setReversing(null);
    reload();
  }

  return {
    canEdit,
    refunding,
    setRefunding,
    amount,
    setAmount,
    refundedOn,
    setRefundedOn,
    note,
    setNote,
    refundError,
    openRefund,
    submitRefund,
    reversing,
    setReversing,
    reverseError,
    openReverse,
    submitReverse,
  };
}

export type RefundForm = ReturnType<typeof useRefund>;
