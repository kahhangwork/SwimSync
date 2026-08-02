// The tokenized public invoice page — where a parent lands from the WhatsApp
// reminder link, with or without a session (PUBLIC_PATHS in app/_layout.tsx).
//
// Data comes from the public-invoice edge function (the 128-bit token in the
// URL is the whole access control); the PayNow QR is computed CLIENT-SIDE
// from that response via lib/paynow — no image is stored anywhere.
//
// You can't scan a QR on the phone you're viewing it on, so the page leads
// with "Save QR image" + the scan-from-gallery instruction (DBS/OCBC/UOB all
// support it), and always shows amount + reference as selectable text for
// manual entry.

import { useEffect, useState } from "react";
import { Image, Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import QRCode from "qrcode";
import Logo from "@/components/Logo";
import PrimaryButton from "@/components/PrimaryButton";
import { buildPayNowPayload, selectPayNowProxy } from "@/lib/paynow";

const FUNCTIONS_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/public-invoice`;

interface PublicInvoice {
  business_name: string;
  paynow_uen: string | null;
  paynow_mobile: string | null;
  reference: string;
  amount: number;
  billing_month: string;
  status: string;
  paid_claimed_at: string | null;
  students: string[];
}

function monthLabel(billingMonth: string): string {
  const [y, m] = billingMonth.split("-").map(Number);
  if (!y || !m) return billingMonth;
  return `${new Date(y, m - 1, 1).toLocaleString("en-SG", { month: "long" })} ${y}`;
}

export default function PublicInvoicePage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "not_found" | "ready">("loading");
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // A leaked URL should never end up in a search index; the token in the
  // address bar is the secret. Best-effort (SPA — no server-side headers).
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `${FUNCTIONS_URL}?token=${encodeURIComponent(token ?? "")}`,
        );
        if (!res.ok) {
          if (!cancelled) setState("not_found");
          return;
        }
        const inv: PublicInvoice = await res.json();
        if (cancelled) return;
        setInvoice(inv);
        setState("ready");

        // QR only when there is something to pay and someone to pay it to.
        const proxy = selectPayNowProxy(inv);
        if (inv.status === "outstanding" && inv.amount > 0 && proxy) {
          // buildPayNowPayload throws on anything dubious (RISK 2) — a
          // failed build means NO QR, never a wrong one.
          const payload = buildPayNowPayload({
            proxyType: proxy.type,
            proxyValue: proxy.value,
            amount: inv.amount,
            merchantName: inv.business_name,
            reference: inv.reference,
          });
          const dataUrl = await QRCode.toDataURL(payload, {
            width: 512,
            margin: 2,
          });
          if (!cancelled) setQrDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) setState("not_found");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function saveQr() {
    if (Platform.OS !== "web" || !qrDataUrl || !invoice) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `paynow-${invoice.reference}.png`;
    a.click();
  }

  if (state === "loading") {
    return (
      <View className="flex-1 bg-sky-50 items-center justify-center">
        <Text className="text-gray-500">Loading invoice…</Text>
      </View>
    );
  }

  if (state === "not_found" || !invoice) {
    return (
      <View className="flex-1 bg-sky-50 items-center justify-center px-6">
        <Logo size="lg" className="mb-4" />
        <Text className="text-xl font-bold text-gray-900 mb-2">
          Invoice not found
        </Text>
        <Text className="text-gray-500 text-center leading-6">
          This link is not valid. Please check with your swim school for a new
          link.
        </Text>
      </View>
    );
  }

  const paid = invoice.status === "paid";
  const claimed = !paid && invoice.paid_claimed_at !== null;

  return (
    <ScrollView
      className="flex-1 bg-sky-50"
      contentContainerClassName="flex-grow px-6 py-10 max-w-xl w-full mx-auto"
    >
      <View className="items-center mb-6">
        <Logo size="lg" className="mb-3" />
        <Text className="text-2xl font-bold text-gray-900">
          {invoice.business_name}
        </Text>
        <Text className="text-gray-500 mt-1">
          Invoice · {monthLabel(invoice.billing_month)}
          {invoice.students.length > 0 ? ` · ${invoice.students.join(", ")}` : ""}
        </Text>
      </View>

      <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 items-center mb-6">
        <Text className="text-sm text-gray-500">Amount due</Text>
        <Text
          selectable
          className="text-4xl font-bold text-gray-900 mt-1 mb-2"
        >
          ${invoice.amount.toFixed(2)}
        </Text>
        <Text selectable className="text-sm text-gray-500">
          Reference: {invoice.reference}
        </Text>

        {paid ? (
          <View className="mt-6 bg-emerald-50 rounded-xl px-6 py-4 items-center">
            <Text className="text-emerald-700 font-semibold text-lg">
              Paid — thank you!
            </Text>
          </View>
        ) : qrDataUrl ? (
          <>
            <Image
              source={{ uri: qrDataUrl }}
              className="w-56 h-56 mt-6"
              resizeMode="contain"
            />
            <Text className="text-xs text-gray-400 mb-4">
              PayNow · amount and reference are locked in
            </Text>
            <PrimaryButton label="Save QR image" onPress={saveQr} />
            <Text className="text-sm text-gray-500 text-center mt-3 leading-5">
              On your phone? Save the QR, then open your banking app and scan
              it from your photo gallery.
            </Text>
          </>
        ) : (
          <View className="mt-6 bg-amber-50 rounded-xl px-6 py-4">
            <Text className="text-amber-800 text-center leading-5">
              Pay by PayNow using the amount and reference above, or contact
              your coach for payment details.
            </Text>
          </View>
        )}

        {claimed && (
          <Text className="text-sm text-sky-700 mt-4">
            You've told us this is paid — your coach will confirm it.
          </Text>
        )}
      </View>

      <Text className="text-center text-xs text-gray-400">
        SwimSync · Swim attendance & billing
      </Text>
    </ScrollView>
  );
}
