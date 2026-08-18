import { describe, expect, it } from "vitest";
import { creditNoteVoidView, voidConfirmMessage } from "./creditNoteVoidState";

// Plan: docs/plans/CREDIT_NOTE_AND_MARKABLE_FLOOR_PLAN.md (Item 3).
// PROVEN RED: allowing status 'reversed' through makes the "already voided" test
// fail; swapping isTenantAdminOfNote for a tenant-id-only check makes the coach and
// platform-admin tests fail; dropping the isDrawn term makes the drawn-consequence
// test fail.

const TENANT_A = "99999999-0000-0000-0000-00000000000a";
const TENANT_B = "99999999-0000-0000-0000-00000000000b";

const available = { status: "available", hasLiveApplications: false, tenantId: TENANT_A };
const adminOfA = { role: "tenant_admin", tenantId: TENANT_A, adminDisabled: false };

describe("creditNoteVoidView", () => {
  it("the note's own tenant admin may void an available note", () => {
    expect(creditNoteVoidView(available, adminOfA)).toEqual({
      canVoid: true,
      isDrawn: false,
      blockedReason: null,
    });
  });

  it("a DRAWN note is voidable and flagged drawn (so the confirm warns)", () => {
    expect(
      creditNoteVoidView({ ...available, hasLiveApplications: true }, adminOfA),
    ).toEqual({ canVoid: true, isDrawn: true, blockedReason: null });
  });

  it("an already-reversed note cannot be voided", () => {
    expect(creditNoteVoidView({ ...available, status: "reversed" }, adminOfA)).toEqual({
      canVoid: false,
      isDrawn: false,
      blockedReason: "reversed",
    });
  });

  it("an 'applied' note is still voidable (that is the spent case CN001 needs)", () => {
    expect(
      creditNoteVoidView({ ...available, status: "applied", hasLiveApplications: true }, adminOfA)
        .canVoid,
    ).toBe(true);
  });

  it("a coach with a matching tenant_id cannot void (role must be tenant_admin)", () => {
    expect(
      creditNoteVoidView(available, { role: "coach", tenantId: TENANT_A, adminDisabled: false }),
    ).toEqual({ canVoid: false, isDrawn: false, blockedReason: "not-your-business" });
  });

  it("a DISABLED admin of the business cannot void", () => {
    expect(
      creditNoteVoidView(available, { role: "tenant_admin", tenantId: TENANT_A, adminDisabled: true }),
    ).toEqual({ canVoid: false, isDrawn: false, blockedReason: "not-your-business" });
  });

  it("a platform admin (or any other business's admin) cannot void this note", () => {
    // role !== 'tenant_admin' OR a different tenant_id — both blocked.
    expect(
      creditNoteVoidView(available, { role: "platform_admin", tenantId: null, adminDisabled: false })
        .canVoid,
    ).toBe(false);
    expect(
      creditNoteVoidView(available, { role: "tenant_admin", tenantId: TENANT_B, adminDisabled: false })
        .blockedReason,
    ).toBe("not-your-business");
  });
});

describe("voidConfirmMessage", () => {
  it("a drawn note's confirm names the clawback and the outstanding invoice", () => {
    const msg = voidConfirmMessage(true, 30, "CN-2026-0001");
    expect(msg).toMatch(/S\$30\.00/);
    expect(msg).toMatch(/outstanding/i);
    expect(msg).toMatch(/CN-2026-0001/);
  });

  it("an undrawn note's confirm just names the removed credit, no invoice talk", () => {
    const msg = voidConfirmMessage(false, 30, "CN-2026-0002");
    expect(msg).toMatch(/S\$30\.00/);
    expect(msg).not.toMatch(/outstanding/i);
  });
});
