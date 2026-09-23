// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-G) — a move, not a
// fix, so §7.25 does not apply.
import { embeddedTenant } from "./embeddedTenant";

describe("embeddedTenant (characterisation)", () => {
  it("reads an embedded tenant as an object or a one-element array; absent is null", () => {
    const t = { display_name: "Coastal", paynow_qr_url: null, paynow_uen: "U1", paynow_mobile: null };
    expect(embeddedTenant({ tenants: t })).toBe(t);
    expect(embeddedTenant({ tenants: [t] })).toBe(t);
    expect(embeddedTenant({ tenants: null })).toBeNull();
    expect(embeddedTenant(null)).toBeNull();
  });
});
