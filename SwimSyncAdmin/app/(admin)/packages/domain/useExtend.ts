// Manual package extension (slice 7). Stage 7 of PACKAGES_REFACTOR_PLAN.md.
// Owns extendError; busy/reload come from usePackageList (⚠ RISK 2).

import { useState } from "react";
import * as rpc from "../dao/packages.rpc";
import type { Purchase } from "../types";

type Shared = {
  setBusy: (b: boolean) => void;
  reload: () => void;
};

export function useExtend({ setBusy, reload }: Shared) {
  const [extending, setExtending] = useState<Purchase | null>(null);
  const [extendWeeks, setExtendWeeks] = useState("1");
  const [extendReason, setExtendReason] = useState("");
  const [extendError, setExtendError] = useState<string | null>(null);

  function openExtend(p: Purchase) {
    setExtendWeeks("1");
    setExtendReason("");
    setExtendError(null);
    setExtending(p);
  }

  async function submitExtend() {
    if (!extending) return;
    const weeks = Number(extendWeeks);
    if (!Number.isInteger(weeks) || weeks <= 0) {
      setExtendError("Enter a whole number of weeks above zero.");
      return;
    }
    const days = weeks * 7;
    if (days > 365) {
      setExtendError("That is too long — 52 weeks is the most.");
      return;
    }
    setBusy(true);
    setExtendError(null);
    const { error: err } = await rpc.extendPackage(
      extending.id,
      days,
      extendReason.trim()
    );
    setBusy(false);
    if (err) {
      setExtendError("Could not extend that package.");
      return;
    }
    setExtending(null);
    setExtendWeeks("1");
    setExtendReason("");
    reload();
  }

  return {
    extending,
    setExtending,
    extendWeeks,
    setExtendWeeks,
    extendReason,
    setExtendReason,
    extendError,
    openExtend,
    submitExtend,
  };
}

export type ExtendForm = ReturnType<typeof useExtend>;
