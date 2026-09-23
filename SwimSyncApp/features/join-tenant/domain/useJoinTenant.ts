// The Join screen's code, and redeeming it (docs/refactor/BATCH_FGH_PLAN.md, app
// fence). Moved VERBATIM from app/(parent)/home/join-tenant.tsx; the RPC is a dao call.
import { useState } from "react";
import { router } from "expo-router";
import { useAppStore } from "@/store/useAppStore";
import { joinTenantByCode } from "../dao/joinTenant.rpc";

export function useJoinTenant() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const showToast = useAppStore((s) => s.showToast);

  async function handleJoin() {
    const entered = code.trim();
    if (!entered) {
      showToast("Enter the code your coach gave you.", "error");
      return;
    }

    setLoading(true);
    const { data, error } = await joinTenantByCode(entered);
    setLoading(false);

    if (error) {
      // The RPC's message is already parent-facing and deliberately identical
      // for every failure, so a wrong code cannot be used to probe which codes
      // are real. Pass it through rather than inventing copy.
      showToast(error.message || "That code was not recognised.", "error");
      return;
    }

    const joined = Array.isArray(data) ? data[0] : data;
    const name = joined?.display_name ?? "your coach";
    // A REF- code both joins AND records a referral — say so, so the family
    // knows their first package will be discounted.
    showToast(
      joined?.referred
        ? `You've joined ${name}. Your first package is discounted!`
        : `You've joined ${name}.`,
      "success",
    );
    router.back();
  }

  return {
    code,
    setCode,
    loading,
    handleJoin,
  };
}
