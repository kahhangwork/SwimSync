// The parent PayNow screen's load and the QR it builds (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). Moved VERBATIM from app/(parent)/billing/paynow.tsx — the params, the
// state, the one load effect and the three derived flags; the two builders are
// dao calls now.
//
// ⚠ plan R2 + R8, named prohibitions that govern this file:
//   • the QR build stays INSIDE the same `try` it always had, here in domain/ —
//     never in ui/. Its catch is load-bearing (the comment inside says why).
//   • the effect's deps stay [invoiceId, packageId], packageId taking precedence,
//     and no cancel guard is added.
//   • the billing-month line is pinned by path in BOTH sgDisplay twins
//     ("parseInt(month) - 1") — repointed here (plan ⚠ R6).
import { useState, useEffect } from "react";
import { Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import QRCode from "qrcode";
import { buildPayNowPayload, selectPayNowProxy } from "@/lib/paynow";
import { fetchPackageForPay, fetchInvoiceForPay } from "../dao/paynow.repo";
import type { Payee, PayeeTenant } from "../types";
import { embeddedTenant } from "./embeddedTenant";

export function usePayNow() {
  const { invoiceId, coachId, packageId } = useLocalSearchParams<{
    invoiceId: string;
    coachId: string;
    /** Paying for a PACKAGE REQUEST instead of an invoice. Same payee logic:
     *  the QR is the business's. Since 20260809000100 a package carries its
     *  own PKG-YYYY-NNNN reference, so it takes the same dynamic-QR path an
     *  invoice does — it used to return early and fall back to the static
     *  image, which is the unattributable payment the reference exists to
     *  remove. */
    packageId: string;
  }>();

  const [netAmount, setNetAmount] = useState<number | null>(null);
  const [billingMonth, setBillingMonth] = useState<string | null>(null);
  const [packageName, setPackageName] = useState<string | null>(null);
  const [payee, setPayee] = useState<Payee | null>(null);
  const [loading, setLoading] = useState(true);
  // Web + a configured PayNow proxy + a reference → a QR with amount and
  // reference LOCKED, computed via lib/paynow. Native keeps the uploaded
  // static image (no canvas there).
  const [dynamicQr, setDynamicQr] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  // The business's PayNow ID, kept even when a QR cannot be built. Without
  // this the no-QR state is a dead end: "contact your coach directly", to a
  // parent who is holding a bill and a banking app and needs neither.
  const [proxy, setProxy] = useState<{ type: "uen" | "mobile"; value: string } | null>(
    null
  );

  useEffect(() => {
    async function load() {
      setLoading(true);

      // The QR comes from the BUSINESS, not the coach who taught the lesson.
      // A school with three coaches has one bank account; showing an
      // individual coach's QR would send a parent's money to the wrong person.
      // For a private coach the tenant is theirs, so nothing changes for them.
      //
      // Both branches resolve the SAME three things — amount, reference,
      // tenant — and then share one QR-building block below. Four hand-written
      // copies of one rule is what caused a live underbill (§7.18); two is how
      // that starts.
      let amount: number | null = null;
      let ref: string | null = null;
      let tenant: PayeeTenant | null = null;

      if (packageId) {
        const { data: pkg } = await fetchPackageForPay(packageId);
        if (pkg) {
          // PRICE surface: the QR must lock the DISCOUNTED amount the family
          // owes (amount_payable), never the package's full worth (total_value).
          amount = Number(pkg.amount_payable);
          ref = pkg.reference_number ?? null;
          setPackageName(pkg.name);
          tenant = embeddedTenant(pkg);
        }
      } else if (invoiceId) {
        const { data: inv } = await fetchInvoiceForPay(invoiceId);
        if (inv) {
          amount = Number(inv.net_amount);
          ref = inv.reference_number ?? null;
          const [year, month] = inv.billing_month.split("-");
          const date = new Date(parseInt(year), parseInt(month) - 1, 1);
          setBillingMonth(
            date.toLocaleDateString("en-SG", { month: "long", year: "numeric" })
          );
          tenant = embeddedTenant(inv);
        }
      }

      if (amount !== null) setNetAmount(amount);
      setReference(ref);

      if (tenant) {
        setPayee({
          business_name: tenant.display_name ?? null,
          paynow_qr_url: tenant.paynow_qr_url ?? null,
        });

        const selected = selectPayNowProxy({
          paynow_uen: tenant.paynow_uen ?? null,
          paynow_mobile: tenant.paynow_mobile ?? null,
        });
        setProxy(selected);

        if (Platform.OS === "web" && selected && ref && amount !== null && amount > 0) {
          try {
            // Throws on anything dubious (RISK 2) — then we simply keep
            // the static-image path instead of showing a wrong QR.
            const payload = buildPayNowPayload({
              proxyType: selected.type,
              proxyValue: selected.value,
              amount,
              merchantName: tenant.display_name ?? "SwimSync",
              reference: ref,
            });
            setDynamicQr(await QRCode.toDataURL(payload, { width: 512, margin: 2 }));
          } catch {
            // fall through to the uploaded static QR, then to the payable
            // PayNow-ID block below. Do NOT widen or remove this catch: the
            // lib throws rather than encode a wrong-yet-valid payload that
            // would pay the wrong amount silently.
          }
        }
      }

      setLoading(false);
    }

    load();
    // coachId is still accepted in the route params for backwards
    // compatibility with existing links, but is no longer used to resolve the
    // payee — the invoice's (or package's) tenant is authoritative.
  }, [invoiceId, packageId]);

  const businessName = payee?.business_name?.trim() || null;
  // A QR of either kind is absent but the business has a PayNow ID: the parent
  // can still pay by hand, which is what every SwimSync parent did before
  // 2026-08-02. Distinct from a business that has configured nothing.
  const showPayableId = !dynamicQr && !payee?.paynow_qr_url && !!proxy;
  const unconfigured = !dynamicQr && !payee?.paynow_qr_url && !proxy;

  return {
    netAmount,
    billingMonth,
    packageName,
    payee,
    loading,
    dynamicQr,
    reference,
    proxy,
    businessName,
    showPayableId,
    unconfigured,
  };
}
