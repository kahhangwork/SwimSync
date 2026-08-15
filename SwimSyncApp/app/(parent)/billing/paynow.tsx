import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";
import { buildPayNowPayload, selectPayNowProxy } from "@/lib/paynow";

/** The business being paid. Named for what it IS: the QR belongs to the
 *  BUSINESS, not the coach who taught the lesson (PRD §7.10). It used to be
 *  called coach_name, which then had to be apologised for in the UI copy. */
type Payee = {
  business_name: string | null;
  paynow_qr_url: string | null;
};

type PayeeTenant = {
  display_name: string | null;
  paynow_qr_url: string | null;
  paynow_uen: string | null;
  paynow_mobile: string | null;
};

/** PostgREST returns an embedded row as an object or a one-element array
 *  depending on the shape it infers. Normalised in one place. */
function embeddedTenant(row: any): PayeeTenant | null {
  const t = Array.isArray(row?.tenants) ? row.tenants[0] : row?.tenants;
  return t ?? null;
}

export default function PayNowScreen() {
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
        const { data: pkg } = await supabase
          .from("parent_packages")
          // Kept on ONE line on purpose: `"a" + "b"` widens to `string`, and
          // the typed client can only parse a select it sees as a literal.
          .select("name, amount_payable, reference_number, tenants(display_name, paynow_qr_url, paynow_uen, paynow_mobile)")
          .eq("id", packageId)
          .single();
        if (pkg) {
          // PRICE surface: the QR must lock the DISCOUNTED amount the family
          // owes (amount_payable), never the package's full worth (total_value).
          amount = Number(pkg.amount_payable);
          ref = pkg.reference_number ?? null;
          setPackageName(pkg.name);
          tenant = embeddedTenant(pkg);
        }
      } else if (invoiceId) {
        const { data: inv } = await supabase
          .from("invoices")
          .select("net_amount, billing_month, reference_number, tenants(display_name, paynow_qr_url, paynow_uen, paynow_mobile)")
          .eq("id", invoiceId)
          .single();
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

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">PayNow Payment</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : (
        <View className="flex-1 items-center px-6 pt-4">
          {/* Amount banner */}
          {netAmount !== null && (
            <View className="w-full bg-red-50 border border-red-100 rounded-2xl p-4 mb-6 items-center">
              <Text className="text-sm text-red-500 mb-1">Amount to Pay</Text>
              <Text className="text-3xl font-bold text-red-600">
                S${netAmount.toFixed(2)}
              </Text>
              {billingMonth && (
                <Text className="text-xs text-red-400 mt-1">{billingMonth}</Text>
              )}
              {packageName && (
                <Text className="text-xs text-red-400 mt-1">{packageName}</Text>
              )}
            </View>
          )}

          {/* QR Code */}
          <View className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 items-center mb-6 w-full">
            <Text className="text-sm font-medium text-gray-500 mb-4">
              {businessName ? `${businessName}'s PayNow` : "PayNow"}
            </Text>

            {dynamicQr ? (
              <Image
                source={{ uri: dynamicQr }}
                className="w-52 h-52 rounded-2xl mb-4"
                resizeMode="contain"
              />
            ) : payee?.paynow_qr_url ? (
              <Image
                source={{ uri: payee.paynow_qr_url }}
                className="w-52 h-52 rounded-2xl mb-4"
                resizeMode="contain"
              />
            ) : showPayableId ? (
              /* No QR of either kind, but the business HAS a PayNow ID — so
                 the parent can pay by hand. Selectable, because they are going
                 to retype it into a banking app. */
              <View className="w-full bg-sky-50 border border-sky-100 rounded-2xl p-4 mb-4">
                <Text className="text-xs text-sky-700 mb-2">
                  Transfer to this PayNow ID
                </Text>
                <Text selectable className="text-xl font-bold text-gray-900 mb-3">
                  {proxy!.type === "mobile" ? `+65 ${proxy!.value}` : proxy!.value}
                </Text>
                <Text className="text-xs text-sky-700 mb-1">Amount</Text>
                <Text selectable className="text-base font-semibold text-gray-900">
                  S${netAmount?.toFixed(2) ?? "—"}
                </Text>
              </View>
            ) : (
              <View className="w-52 h-52 bg-gray-100 rounded-2xl items-center justify-center mb-4">
                <Ionicons name="qr-code-outline" size={80} color="#9ca3af" />
                <Text className="text-xs text-gray-400 mt-2 text-center px-4">
                  This business hasn't set up PayNow yet. Ask them to add their
                  PayNow ID in SwimSync.
                </Text>
              </View>
            )}

            {reference && (
              <Text selectable className="text-xs text-gray-500 mb-2">
                Reference: {reference}
              </Text>
            )}
            <Text className="text-xs text-gray-400 text-center leading-relaxed">
              {dynamicQr
                ? "Scan with your banking app — the amount and reference are locked into this QR."
                : showPayableId
                ? "Enter the PayNow ID, amount and reference in your banking app."
                : unconfigured
                ? "PayNow is not available for this business yet."
                : "Scan the QR code above with your banking app to make a PayNow transfer. The amount shown above is for reference only."}
            </Text>
          </View>

          {/* Instructions */}
          {!unconfigured && (
            <View className="w-full bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <Text className="text-sm font-bold text-gray-900 mb-3">
                Payment Instructions
              </Text>
              {(showPayableId
                ? [
                    "Open your banking app",
                    "Tap PayNow, then Enter PayNow ID",
                    "Enter the PayNow ID shown above",
                    "Enter the exact amount shown",
                    reference
                      ? `Put ${reference} in the reference or comments field`
                      : "Complete the transfer",
                  ]
                : [
                    "Open your banking app",
                    "Tap Scan to Pay or QR",
                    "Scan the QR code above",
                    dynamicQr
                      ? "Check the amount matches this bill"
                      : "Enter the exact amount shown",
                    "Complete the transfer",
                  ]
              ).map((step, i) => (
                <View key={i} className="flex-row gap-3 mb-2 items-start">
                  <View className="w-5 h-5 rounded-full bg-sky-100 items-center justify-center mt-0.5">
                    <Text className="text-xs font-bold text-sky-600">{i + 1}</Text>
                  </View>
                  <Text className="text-sm text-gray-600 flex-1">{step}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
