// PayNow QR payload generation (EMVCo merchant-presented QR, SGQR profile).
//
// A PayNow QR is a computed STRING, not an uploaded image: TLV fields
// (tag + 2-digit length + value) ending in a CRC-16. This lib builds the
// payload for a per-invoice QR with the amount LOCKED (editable=0) and the
// invoice's reference embedded (Tag 62 sub-01, the "bill number" banks echo
// back on corporate statements).
//
// ⚠ RISK 2 (PAYMENT_COLLECTION_DESIGN.md): a malformed payload fails loudly
// in the bank app, but a wrong-yet-valid one pays the wrong amount silently.
// So this module THROWS on any input it cannot vouch for — it never encodes
// garbage. The test vectors in paynow.test.ts are pinned to an INDEPENDENT
// generator's output (VirgilZhao/paynow), not to this lib's own output, and
// the final certification is a real bank-app scan (release gate), which no
// unit test can replace.

const PROXY_TYPE = { mobile: "0", uen: "2" } as const;

export type PayNowProxyType = keyof typeof PROXY_TYPE;

export interface PayNowPayloadOpts {
  proxyType: PayNowProxyType;
  /** mobile: exactly 8 digits as stored on tenants.paynow_mobile; uen: as stored. */
  proxyValue: string;
  /** SGD. Must be finite and > 0 — a $0/NaN QR is refused, never encoded. */
  amount: number;
  /** Shown by the payer's bank app. Truncated to EMV's 25-char cap. */
  merchantName: string;
  /** The invoice reference (INV-YYYY-NNNN). 1–25 chars, Tag 62 limit. */
  reference: string;
  /** Optional YYYYMMDD expiry (Tag 26-04). Unused by invoices; kept so the
   *  external test vector can be reproduced byte-for-byte. */
  expiry?: string;
}

/** One TLV field: 2-digit tag + 2-digit zero-padded length + value. */
function tlv(tag: string, value: string): string {
  if (value.length > 99) throw new Error(`paynow: tag ${tag} value too long`);
  return tag + String(value.length).padStart(2, "0") + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), uppercase 4-hex.
 *  Exported for the independent "123456789" → 29B1 vector. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildPayNowPayload(opts: PayNowPayloadOpts): string {
  const { proxyType, amount, merchantName, reference, expiry } = opts;
  const proxyValue = opts.proxyValue.trim();

  // Refuse, never guess (§7.22's Number("") family: NaN and 0 must not
  // become a scannable QR).
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`paynow: refusing amount ${amount}`);
  }
  if (proxyType === "mobile" && !/^\d{8}$/.test(proxyValue)) {
    throw new Error("paynow: mobile proxy must be exactly 8 digits (stored bare)");
  }
  if (proxyType === "uen" && proxyValue === "") {
    throw new Error("paynow: blank UEN");
  }
  const ref = reference.trim();
  if (ref.length < 1 || ref.length > 25) {
    throw new Error("paynow: reference must be 1-25 chars (EMV Tag 62 limit)");
  }
  const name = merchantName.trim().slice(0, 25);
  if (name === "") throw new Error("paynow: blank merchant name");
  if (expiry !== undefined && !/^\d{8}$/.test(expiry)) {
    throw new Error("paynow: expiry must be YYYYMMDD");
  }

  const account =
    tlv("00", "SG.PAYNOW") +
    tlv("01", PROXY_TYPE[proxyType]) +
    tlv("02", proxyType === "mobile" ? `+65${proxyValue}` : proxyValue) +
    tlv("03", "0") + // amount NOT editable — the whole point of a dynamic QR
    (expiry !== undefined ? tlv("04", expiry) : "");

  const body =
    tlv("00", "01") + // payload format indicator
    tlv("01", "12") + // dynamic (amount present)
    tlv("26", account) +
    tlv("52", "0000") + // MCC: none
    tlv("53", "702") + // SGD
    tlv("54", amount.toFixed(2)) +
    tlv("58", "SG") +
    tlv("59", name) +
    tlv("60", "Singapore") +
    tlv("62", tlv("01", ref));

  return body + "6304" + crc16(body + "6304");
}

/** UEN wins when both proxies are set — a corporate account is guaranteed to
 *  receive the reference on its statement; a personal mobile proxy is
 *  best-effort (bank-dependent). Blank strings count as absent. */
export function selectPayNowProxy(tenant: {
  paynow_uen: string | null;
  paynow_mobile: string | null;
}): { type: PayNowProxyType; value: string } | null {
  const uen = tenant.paynow_uen?.trim();
  if (uen) return { type: "uen", value: uen };
  const mobile = tenant.paynow_mobile?.trim();
  if (mobile) return { type: "mobile", value: mobile };
  return null;
}
