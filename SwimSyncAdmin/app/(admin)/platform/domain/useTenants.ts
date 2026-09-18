// The tenant overview — the SPINE of this page. Stage 5 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// `load` is the one function the three writer slices await after a successful
// write (provisioning, owner transfer, suspend). They receive it as a creation
// dependency; none of them re-implements it.
//
// ⚠ THE TWO ERRORS ARE HANDLED ASYMMETRICALLY, ON PURPOSE. The overview's error
// is surfaced (an unchecked failure leaves the table empty, which reads as "no
// businesses" — false reassurance on the one page that exists to show trouble).
// The stranded-parents error is SWALLOWED: it only hides an advisory panel, and
// checking it would blank the businesses table over a failure in a side query.
// Do NOT add a strandedRes.error check here.
//
// ⚠ `tenants` is NOT cleared on an overview error — the previous rows stay put
// under the red banner. Clearing them would turn a transient read failure into
// an apparent platform-wide outage.

import { useState } from "react";
import { loadOverview } from "../dao/platform.rpc";
import type { StrandedParent, TenantRow } from "../types";

export function useTenants() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [stranded, setStranded] = useState<StrandedParent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * One round trip for the whole overview.
   *
   * This replaced an N+1 loop of client-side counts. Two reasons, and the
   * second is the load-bearing one: the loop issued 2 queries per tenant, and
   * more importantly every client-side aggregate here is capped at
   * max_rows = 1000 SILENTLY — no error, just fewer rows — while a platform
   * admin reads every tenant's data. Postgres has no such ceiling.
   *
   * The RPC gates on is_platform_admin() itself, so an empty result is also the
   * correct answer for anyone else. Errors are surfaced rather than swallowed:
   * an unchecked failure leaves the table empty, which reads as "no businesses"
   * — false reassurance on the one page that exists to show trouble.
   */
  async function load() {
    const [overview, strandedRes] = await loadOverview();
    if (overview.error) {
      setLoadError(overview.error.message);
      return;
    }
    setLoadError(null);
    setTenants((overview.data ?? []) as TenantRow[]);
    setStranded((strandedRes.data ?? []) as StrandedParent[]);
  }

  return { tenants, stranded, loadError, load };
}
