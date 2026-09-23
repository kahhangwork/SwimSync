// Moved VERBATIM from app/(parent)/billing/paynow.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); pinned by embeddedTenant.test.ts.
import type { PayeeTenant } from "../types";

/** PostgREST returns an embedded row as an object or a one-element array
 *  depending on the shape it infers. Normalised in one place. */
export function embeddedTenant(row: any): PayeeTenant | null {
  const t = Array.isArray(row?.tenants) ? row.tenants[0] : row?.tenants;
  return t ?? null;
}
