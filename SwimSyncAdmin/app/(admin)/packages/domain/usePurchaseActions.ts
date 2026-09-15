// confirm-payment + cancel (slices 5 and 6) of the Packages page. Stage 5 of
// PACKAGES_REFACTOR_PLAN.md. busy/error/reload come from usePackageList
// (⚠ RISK 2). The confirming effect moves VERBATIM (⚠ RISK 8): dep [confirming],
// the exhaustive-deps disable, and NO reset of confirmStart on close.

import { useEffect, useState } from "react";
import { todayInSg } from "@/lib/lessonDates";
import * as repo from "../dao/packages.repo";
import * as rpc from "../dao/packages.rpc";
import { defaultConfirmStart } from "./packageOffers";
import type { Purchase } from "../types";

type Shared = {
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  reload: () => void;
};

export function usePurchaseActions({ setBusy, setError, reload }: Shared) {
  const [confirming, setConfirming] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState<Purchase | null>(null);
  const [confirmStart, setConfirmStart] = useState("");

  // Confirm dialog: pre-fill the start date. ⚠ RISK 3 — an OFFER carries the
  // start_date the parent paid against, so adopt THAT; only a parent-created
  // request (no start_date) falls back to the freshly-suggested one.
  useEffect(() => {
    if (confirming) {
      rpc.fetchSuggestedStart(confirming.parent_id, confirming.product_id).then(
        (suggested) =>
          setConfirmStart(defaultConfirmStart(confirming.start_date, suggested))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming]);

  async function confirmPurchase(p: Purchase) {
    setBusy(true);
    const { error: err } = await repo.activatePendingPurchase(
      p.id,
      confirmStart || todayInSg()
    );
    setBusy(false);
    setConfirming(null);
    if (err) {
      setError("Could not confirm that purchase.");
      return;
    }
    // Best-effort "your package is active" email to the parent. Never blocks
    // or fails the confirmation — the package is already active.
    rpc
      .invokePackageEmail({ type: "confirmed", package_id: p.id })
      .catch(() => {});

    // If activating this package converted a referral, tell the REFERRER they
    // earned a reward. Best-effort, and independent of the confirmed email
    // above: the conversion + referrer reward are minted by the DB trigger, so
    // we look the reward up and hand its id to package-emails (RISK 3 path).
    (async () => {
      const { data: ref } = await repo.findConvertedReferral(p.id);
      if (!ref) return;
      const { data: reward } = await repo.findReferrerReward(ref.id);
      if (!reward) return;
      await rpc
        .invokePackageEmail({ type: "referral_reward", reward_id: reward.id })
        .catch(() => {});
    })().catch(() => {});

    reload();
  }

  async function cancelPurchase(p: Purchase) {
    setBusy(true);
    const { error: err } = await repo.cancelPurchase(p.id);
    setBusy(false);
    setCancelling(null);
    if (err) {
      setError("Could not cancel that package.");
      return;
    }
    reload();
  }

  return {
    confirming,
    setConfirming,
    cancelling,
    setCancelling,
    confirmStart,
    setConfirmStart,
    confirmPurchase,
    cancelPurchase,
  };
}
