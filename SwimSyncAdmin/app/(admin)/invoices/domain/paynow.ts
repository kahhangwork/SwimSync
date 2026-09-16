// Advisory PayNow proxy validation for the admin save path (Wave D, BACKLOG §Wave D).
//
// A mistyped mobile number saves clean today, and the parent's device then can't
// build a QR from it — the business silently collects nothing. This flags the
// obviously-broken case AT SAVE, advisory only (a bad value still saves — the
// sgPhone doctrine; a blocked save helps nobody).
//
// SOURCE OF TRUTH is SwimSyncApp/lib/paynow.ts:buildPayNowPayload, which THROWS on
// a proxy it cannot vouch for. The admin stores the raw value and cannot import
// across packages, so this MIRRORS that function's proxy checks (paynow.ts lines
// 64-69). Keep them in sync — a QR is money. A UEN has no checksum, so a
// mistyped-but-plausible UEN cannot be caught here (the real builder accepts any
// non-blank UEN); only the mobile shape is verifiable.
export function payNowProxyWarning(
  field: "paynow_uen" | "paynow_mobile",
  value: string | null,
): string | null {
  const v = (value ?? "").trim();
  if (v === "") return null; // clearing a field is legitimate, not an error
  if (field === "paynow_mobile" && !/^\d{8}$/.test(v)) {
    return "That mobile number isn't 8 digits, so a payment QR can't be built from it — parents will see no QR until it's fixed.";
  }
  return null;
}
