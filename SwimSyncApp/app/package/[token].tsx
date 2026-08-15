// The tokenized public PACKAGE-OFFER page — where a parent lands from the
// WhatsApp/email renewal link, with or without a session (PUBLIC_PATHS in
// app/_layout.tsx). The package mirror of invoice/[token].tsx.
//
// Data comes from the public-package edge function (the 128-bit token in the
// URL is the whole access control); the PayNow QR is computed CLIENT-SIDE from
// that response via lib/paynow — no image is stored anywhere. The QR + "I've
// paid" appear ONLY while the offer is pending (RISK 5): a stale link for a
// superseded / already-active offer must not present a payable QR.

import { useEffect, useState } from "react";
import { Image, Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import QRCode from "qrcode";
import Logo from "@/components/Logo";
import PrimaryButton from "@/components/PrimaryButton";
import { confirmAction } from "@/lib/confirm";
import { buildPayNowPayload, selectPayNowProxy } from "@/lib/paynow";

const FUNCTIONS_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/public-package`;

interface PublicPackage {
  business_name: string;
  paynow_uen: string | null;
  paynow_mobile: string | null;
  reference: string;
  amount: number;
  package_name: string;
  lesson_count: number;
  rate: number;
  start_date: string | null;
  valid_until_preview: string | null;
  status: string;
  paid_claimed_at: string | null;
}

// "2026-09-01" → "1 Sep 2026", no Date object → no timezone drift.
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  if (!month) return dateStr;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

export default function PublicPackagePage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "not_found" | "ready">("loading");
  const [pkg, setPkg] = useState<PublicPackage | null>(null);
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
        const p: PublicPackage = await res.json();
        if (cancelled) return;
        setPkg(p);
        setState("ready");

        // QR only for a PENDING offer with something to pay and someone to pay
        // it to. A superseded / active offer shows no QR (RISK 5).
        const proxy = selectPayNowProxy(p);
        if (p.status === "pending" && p.amount > 0 && proxy) {
          // buildPayNowPayload throws on anything dubious — a failed build
          // means NO QR, never a wrong one.
          const payload = buildPayNowPayload({
            proxyType: proxy.type,
            proxyValue: proxy.value,
            amount: p.amount,
            merchantName: p.business_name,
            reference: p.reference,
          });
          const dataUrl = await QRCode.toDataURL(payload, { width: 512, margin: 2 });
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
    if (Platform.OS !== "web" || !qrDataUrl || !pkg) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `paynow-${pkg.reference}.png`;
    a.click();
  }

  const [claiming, setClaiming] = useState(false);

  // The sessionless "I've paid" — a timestamped CLAIM the coach confirms
  // against their bank, never a status change. Web-safe confirm (§7.10).
  function claimPaid() {
    if (!pkg || claiming) return;
    confirmAction(
      "Mark as paid?",
      "This tells your coach you've made the PayNow transfer. They'll confirm it against their bank account, and your package activates then.",
      async () => {
        setClaiming(true);
        try {
          const res = await fetch(FUNCTIONS_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token, action: "claim" }),
          });
          if (res.ok) {
            const { paid_claimed_at } = await res.json();
            setPkg((prev) => (prev ? { ...prev, paid_claimed_at } : prev));
          }
        } finally {
          setClaiming(false);
        }
      },
      "I've paid",
    );
  }

  if (state === "loading") {
    return (
      <View className="flex-1 bg-sky-50 items-center justify-center">
        <Text className="text-gray-500">Loading package…</Text>
      </View>
    );
  }

  if (state === "not_found" || !pkg) {
    return (
      <View className="flex-1 bg-sky-50 items-center justify-center px-6">
        <Logo size="lg" className="mb-4" />
        <Text className="text-xl font-bold text-gray-900 mb-2">
          Package not found
        </Text>
        <Text className="text-gray-500 text-center leading-6">
          This link is not valid. Please check with your swim school for a new
          link.
        </Text>
      </View>
    );
  }

  const active = pkg.status === "active";
  const pending = pkg.status === "pending";
  const claimed = pending && pkg.paid_claimed_at !== null;
  const validUntil = formatDate(pkg.valid_until_preview);
  const startDate = formatDate(pkg.start_date);

  return (
    <ScrollView
      className="flex-1 bg-sky-50"
      contentContainerClassName="flex-grow px-6 py-10 max-w-xl w-full mx-auto"
    >
      <View className="items-center mb-6">
        <Logo size="lg" className="mb-3" />
        <Text className="text-2xl font-bold text-gray-900">
          {pkg.business_name}
        </Text>
        <Text className="text-gray-500 mt-1">Package · {pkg.package_name}</Text>
      </View>

      <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 items-center mb-6">
        <Text className="text-sm text-gray-500">Amount</Text>
        <Text selectable className="text-4xl font-bold text-gray-900 mt-1 mb-2">
          ${pkg.amount.toFixed(2)}
        </Text>
        <Text className="text-sm text-gray-500">
          {pkg.lesson_count} lessons · ${pkg.rate.toFixed(2)} each
        </Text>
        <Text selectable className="text-sm text-gray-500 mt-1">
          Reference: {pkg.reference}
        </Text>
        {startDate ? (
          <Text className="text-sm text-gray-500 mt-1">Starts {startDate}</Text>
        ) : null}
        {validUntil ? (
          <Text className="text-xs text-gray-400 mt-1">
            Valid until at least {validUntil}
          </Text>
        ) : null}

        {active ? (
          <View className="mt-6 bg-emerald-50 rounded-xl px-6 py-4 items-center">
            <Text className="text-emerald-700 font-semibold text-lg">
              Active — thank you!
            </Text>
          </View>
        ) : !pending ? (
          <View className="mt-6 bg-gray-50 rounded-xl px-6 py-4">
            <Text className="text-gray-600 text-center leading-5">
              This offer is no longer available. Please check with your coach.
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
              On your phone? Save the QR, then open your banking app and scan it
              from your photo gallery.
            </Text>
          </>
        ) : (
          <View className="mt-6 bg-amber-50 rounded-xl px-6 py-4">
            <Text className="text-amber-800 text-center leading-5">
              Pay by PayNow using the amount and reference above, or contact your
              coach for payment details.
            </Text>
          </View>
        )}

        {pending &&
          (claimed ? (
            <Text className="text-sm text-sky-700 mt-4">
              You've told us this is paid — your coach will confirm it.
            </Text>
          ) : (
            <View className="mt-4 w-full">
              <PrimaryButton
                label={claiming ? "Saving…" : "I've paid"}
                variant="outline"
                onPress={claimPaid}
              />
            </View>
          ))}
      </View>

      <Text className="text-center text-sm text-gray-500 mb-2">
        Prefer a different package? Tell your coach.
      </Text>
      <Text className="text-center text-xs text-gray-400">
        SwimSync · Swim attendance & billing
      </Text>
    </ScrollView>
  );
}
