// The amount, terms and reference; the QR only while PENDING (RISK 5); "I've paid".
// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
//
// UI restyle step 4.6 (DESIGN.md): a flat card; every amount written S$ in
// tabular figures (they were bare "$" — Aligned Money), the discount in Ink
// Secondary rather than green; Pay-First — "Save QR image" the one primary, "I've
// paid" a text link beneath it; Active is Success, a stale offer Neutral, a claim
// Info. No figure is recomputed and no condition changed — active / pending /
// claimed / qrDataUrl are the page's.
import React from "react";
import { Image, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { PublicPackage } from "../types";
import { formatSgd } from "@/lib/money";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function OfferCard(p: { pkg: PublicPackage; startDate: string | null; validUntil: string | null; active: boolean; pending: boolean; qrDataUrl: string | null; saveQr: () => void; claimed: boolean; claiming: boolean; claimPaid: () => void }) {
  const { pkg, startDate, validUntil, active, pending, qrDataUrl, saveQr, claimed, claiming, claimPaid } = p;
  return (
    <>
      <Surface className="items-center mb-6">
        <Text className="text-body-secondary text-ink-secondary">Amount</Text>
        <Text selectable className="text-display font-semibold text-ink mt-1 mb-2" style={TABULAR}>
          {formatSgd(pkg.amount)}
        </Text>
        {pkg.discount_amount > 0 ? (
          <Text className="text-body-secondary text-ink-secondary mb-1" style={TABULAR}>
            {formatSgd(pkg.total_value)} − {formatSgd(pkg.discount_amount)} referral discount
          </Text>
        ) : null}
        <Text className="text-body-secondary text-ink-secondary" style={TABULAR}>
          {pkg.lesson_count} lessons · {formatSgd(pkg.rate)} each
        </Text>
        <Text selectable className="text-body-secondary text-ink-secondary mt-1">
          Reference: {pkg.reference}
        </Text>
        {startDate ? (
          <Text className="text-body-secondary text-ink-secondary mt-1">Starts {startDate}</Text>
        ) : null}
        {validUntil ? (
          <Text className="text-label text-ink-muted mt-1">
            Valid until at least {validUntil}
          </Text>
        ) : null}

        {active ? (
          <View className="mt-5 w-full bg-status-success-bg border border-status-success-border rounded-card px-4 py-3 items-center">
            <Text className="text-headline font-semibold text-status-success-text">
              Active — thank you!
            </Text>
          </View>
        ) : !pending ? (
          <View className="mt-5 w-full bg-status-neutral-bg border border-status-neutral-border rounded-card px-4 py-3">
            <Text className="text-body text-status-neutral-text text-center">
              This offer is no longer available. Please check with your coach.
            </Text>
          </View>
        ) : qrDataUrl ? (
          <>
            <Image
              source={{ uri: qrDataUrl }}
              className="w-56 h-56 mt-5"
              resizeMode="contain"
            />
            <Text className="text-label text-ink-muted mb-4">
              PayNow · amount and reference are locked in
            </Text>
            <Button label="Save QR image" onPress={saveQr} className="w-full" />
            <Text className="text-body-secondary text-ink-secondary text-center mt-3">
              On your phone? Save the QR, then open your banking app and scan it
              from your photo gallery.
            </Text>
          </>
        ) : (
          <View className="mt-5 w-full bg-ground border border-border rounded-card px-4 py-3">
            <Text className="text-body text-ink text-center">
              Pay by PayNow using the amount and reference above, or contact your
              coach for payment details.
            </Text>
          </View>
        )}

        {pending &&
          (claimed ? (
            <View className="mt-4 w-full bg-status-info-bg border border-status-info-border rounded-card px-4 py-3">
              <Text className="text-body text-status-info-text text-center">
                You've told us this is paid — your coach will confirm it.
              </Text>
            </View>
          ) : (
            <Button
              label={claiming ? "Saving…" : "I've paid"}
              variant="link"
              onPress={claimPaid}
              className="mt-2 items-center w-full"
            />
          ))}
      </Surface>
    </>
  );
}
