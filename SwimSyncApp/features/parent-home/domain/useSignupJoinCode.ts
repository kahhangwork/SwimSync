// Apply a join/referral code entered at registration, ONCE
// (docs/refactor/BATCH_FGH_PLAN.md, App L-F) — the effect moved VERBATIM from
// app/(parent)/home/index.tsx, its builders now dao calls.
//
// ⚠ THE DEPS ARRAY IS BYTE-IDENTICAL: [session, showToast, loadData]. The route
// calls this hook BEFORE its useFocusEffect, so the two effects run in the order
// they were declared on the route (plan ⚠ R4). No verify-* driver fills a join
// code on register — L4-F hand-checks it (plan ⚠ R5).
import { useEffect } from "react";
import type { useParentHome } from "./useParentHome";
import { fetchSignupJoinCode, clearSignupJoinCode } from "../dao/parentHome.repo";
import { joinTenantByCode } from "../dao/parentHome.rpc";

type Home = ReturnType<typeof useParentHome>;

export function useSignupJoinCode(
  session: Home["session"],
  showToast: Home["showToast"],
  loadData: Home["loadData"]
) {
  // Apply a join/referral code entered at registration, ONCE. Email
  // confirmation defers any session, so it could not be applied at signup;
  // handle_new_user parked it on parents.signup_join_code. We clear it whatever
  // the outcome, so a bad code never retries forever.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      const { data: p } = await fetchSignupJoinCode(session);
      if (cancelled || !p?.signup_join_code) return;
      const { data, error } = await joinTenantByCode(p.signup_join_code);
      await clearSignupJoinCode(p.id);
      if (cancelled || error) return;
      const joined = Array.isArray(data) ? data[0] : data;
      const name = joined?.display_name ?? "your coach";
      showToast(
        joined?.referred
          ? `Joined ${name}. Your first package is discounted!`
          : `Joined ${name}.`,
        "success",
      );
      loadData();
    })();
    return () => {
      cancelled = true;
    };
  }, [session, showToast, loadData]);
}
