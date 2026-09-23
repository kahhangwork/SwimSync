// The public package-offer page's state, its load, Save QR and the sessionless
// "I've paid" (docs/refactor/BATCH_FGH_PLAN.md, App L-G). Moved VERBATIM from
// app/package/[token].tsx — hooks in their original order (the claiming state is
// still declared AFTER the two effects); the two fetch( calls are dao/ now.
//
// ⚠ plan R2: the QR build stays INSIDE the load's try, after the fetch — a
// throwing payload still renders "Package not found", exactly as before. The QR
// is built ONLY for a pending offer (RISK 5). The claim keeps its try/finally.
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import QRCode from "qrcode";
import { confirmAction } from "@/lib/confirm";
import { buildPayNowPayload, selectPayNowProxy } from "@/lib/paynow";
import { fetchPublicPackage, postPublicPackageClaim } from "../dao/publicPackage.api";
import type { PublicPackage } from "../types";

export function usePublicPackage() {
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
        const res = await fetchPublicPackage(token);
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
          const res = await postPublicPackageClaim(token);
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

  return { state, pkg, qrDataUrl, saveQr, claiming, claimPaid };
}
