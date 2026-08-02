import { invoiceLabel } from "./invoiceLabel";

const ID = "3f2b8c1a-0000-4000-8000-000000000001";

describe("invoiceLabel", () => {
  // ⚠ THE POINT OF THIS FILE. The QR, the WhatsApp reminder, the public
  // invoice page and the parent's bank statement all say INV-2026-0001. The
  // app used to say "Invoice #3F2B8C1A" — a fragment of the row's UUID — so a
  // parent checking the app against their own payment saw two different
  // numbers for the same invoice and had nothing to quote back.
  it("uses the reference number when the invoice has one", () => {
    expect(invoiceLabel({ id: ID, reference_number: "INV-2026-0001" })).toBe(
      "INV-2026-0001"
    );
  });

  it("never shows the UUID when a reference exists", () => {
    const label = invoiceLabel({ id: ID, reference_number: "INV-2026-0042" });
    expect(label).not.toContain("3F2B8C1A");
    expect(label).not.toContain(ID);
  });

  // The fallback is not dead code: rows written before the reference trigger
  // existed have none, and seed/fixture data still does. A blank where an
  // invoice number belongs is worse than the old identifier.
  it("falls back to the legacy UUID fragment when the reference is null", () => {
    expect(invoiceLabel({ id: ID, reference_number: null })).toBe(
      "Invoice #3F2B8C1A"
    );
  });

  it("falls back when the field is absent entirely", () => {
    expect(invoiceLabel({ id: ID })).toBe("Invoice #3F2B8C1A");
  });

  // A reference of "" or "   " is indistinguishable from having none, and must
  // not render as an empty label.
  it.each(["", "   "])("falls back for a blank reference (%j)", (blank) => {
    expect(invoiceLabel({ id: ID, reference_number: blank })).toBe(
      "Invoice #3F2B8C1A"
    );
  });

  it("trims a padded reference rather than rendering the padding", () => {
    expect(
      invoiceLabel({ id: ID, reference_number: "  INV-2026-0007  " })
    ).toBe("INV-2026-0007");
  });

  it("never returns an empty string", () => {
    for (const ref of [null, undefined, "", "  ", "INV-2026-0001"]) {
      expect(
        invoiceLabel({ id: ID, reference_number: ref as string | null })
      ).not.toBe("");
    }
  });
});
